import type { ReactFormState } from 'react-dom/client'

import {
	createTemporaryReferenceSet,
	decodeAction,
	decodeFormState,
	decodeReply,
	loadServerAction,
	renderToReadableStream,
} from '@vitejs/plugin-rsc/rsc'

import type { DriftRequest, ImportMap, Manifest, PluginConfig } from '../../types'

import { Drift } from '../../drift'

import { Logger } from '../../utils/logger'
import { getKnownDigest, isKnownError } from './utils'

import type { SSRModule } from './ssr'
import { Metadata } from '../metadata'
import { HttpException, isHttpException } from '../navigation/http-exception'
import { Prerender } from '../prerender'
import { Tree } from '../render/tree'
import { createRouter } from '../router/create-router'
import { Resolver } from '../router/resolver'
import { Router } from '../router/router'
import DefaultErr from '../ui/defaults/error'
import { RequestContext } from './request-context'

export type RSCPayload = {
	returnValue?: { ok: boolean; data: unknown }
	formState?: ReactFormState
	root: React.ReactNode
	metadata?: Promise<Metadata.Item>
}

/**
 * Get the streamed RSC payload and response metadata for a single request.
 * Resolves the route match, collects metadata, and returns the stream,
 * status code, and PPR mode needed by the response layer
 */
async function getPayload(
	req: DriftRequest,
	manifest: Manifest,
	importMap: ImportMap,
	baseMetadata?: Metadata.Item,
	returnValue?: { ok: boolean; data: unknown },
	formState?: ReactFormState,
	temporaryReferences?: unknown,
) {
	const resolver = new Resolver(manifest, importMap)
	const logger = new Logger()
	const prerender = req.headers.get('x-drift-prerender') === '1'
	const url = new URL(req.url)
	const pathname =
		url.pathname.endsWith('/') && url.pathname !== '/'
			? url.pathname.slice(0, -1)
			: url.pathname
	const match = resolver.enhance(
		resolver.reconcile(
			pathname,
			req[Drift.Config.REQUEST_META].match,
			req[Drift.Config.REQUEST_META].error,
		),
	)

	// if there's no match then no user supplied error boundary
	// has been found, and we should server render a default
	// error screen
	if (!match) {
		const error =
			req[Drift.Config.REQUEST_META].error ?? new HttpException(404, 'Not found')
		const title = `${'status' in error ? `${error.status} -` : ''}${error.message}`

		const rscPayload: RSCPayload = {
			root: (
				<html lang="en">
					<head>
						<meta charSet="UTF-8" />
						<meta name="viewport" content="width=device-width, initial-scale=1.0" />
						<meta name="robots" content="noindex,nofollow" />

						<title>{title}</title>
					</head>

					<body>
						<DefaultErr error={error} />
					</body>
				</html>
			),
			returnValue,
			formState,
		}

		return {
			// this path is a safety fallback when a prerender request
			// hits an unmatched route. In build prerender we force
			// mode to 'full' so the 404/error shell resolves
			// immediately. In normal request-time rendering
			// we keep mode as null (obvi)
			stream: RequestContext.write(
				{
					req,
					prerender: prerender ? 'full' : null,
					cache: {},
				},
				() =>
					renderToReadableStream(rscPayload, {
						temporaryReferences,
						onError(err: unknown) {
							if (err == null) return

							const digest = getKnownDigest(err)

							if (digest) return digest
							if (isKnownError(err)) return

							logger.error('[rsc]', err)
						},
					}),
			),
			status: 404,
			ppr: false,
		}
	}

	// check if this route is a candidate for ppr
	const ppr = match.prerender === 'ppr'
	const collection = new Metadata.Collection(baseMetadata)
	const metadata = collection
		.add(...(match.metadata?.({ params: match.params, error: match.error }) ?? []))
		.run()

	const rscPayload: RSCPayload = {
		root: (
			<>
				<Tree
					depth={match.__depth}
					params={match.params}
					error={match.error}
					ui={match.ui}
				/>
			</>
		),
		returnValue,
		formState,
		metadata,
	}

	// status code comes from route match error if any
	const status = isHttpException(match.error) ? match.error.status : 200

	try {
		// this is the main matched route render pass for page/layout
		// tree output. Mode is null for normal ssr, 'full' for full
		// prerender, and 'ppr' for ppr prerender. dynamic() only
		// suspends when mode is 'ppr'
		const stream = RequestContext.write(
			{
				req,
				prerender: prerender ? (ppr ? 'ppr' : 'full') : null,
				cache: {},
			},
			() =>
				renderToReadableStream(rscPayload, {
					temporaryReferences,
					onError(err: unknown) {
						if (err == null) return

						const digest = getKnownDigest(err)

						if (digest) return digest
						if (isKnownError(err)) return

						logger.error('[rsc]', err)
					},
				}),
		)

		return { stream, status, ppr }
	} catch (err) {
		// shell failed to render - return minimal fallback
		logger.error('rsc shell', err)

		const title =
			err instanceof Error
				? 'status' in err
					? `${err.status} - ${err.message}`
					: `500 - ${err.message}`
				: '500 - Unknown server error'
		const error = new Error(err instanceof Error ? err.message : 'Unknown server error', {
			cause: err,
		})

		return {
			// this branch renders the minimal error shell after the
			// main tree throws. We keep the same mode as the
			// request so helpers see consistent state
			// prevents mode drift on error paths
			stream: RequestContext.write(
				{
					req,
					prerender: prerender ? 'full' : null,
					cache: {},
				},
				() =>
					renderToReadableStream(
						{
							root: (
								<html lang="en">
									<head>
										<meta charSet="UTF-8" />
										<meta
											name="viewport"
											content="width=device-width, initial-scale=1.0"
										/>
										<meta name="robots" content="noindex,nofollow" />

										<title>{title}</title>
									</head>

									<body>
										<DefaultErr error={error} />
									</body>
								</html>
							),
							returnValue,
							formState,
						},
						{
							temporaryReferences,
						},
					),
			),
			status: 500,
			ppr: false,
		}
	}
}

export async function action(req: DriftRequest) {
	let returnValue: { ok: boolean; data: unknown } | undefined
	let formState: ReactFormState | undefined
	let temporaryReferences: unknown

	const id = req.headers.get('x-rsc-action-id')

	if (id) {
		// x-rsc-action-id header exists when action is
		// called via ReactClient.setServerCallback
		const body = req.headers.get('content-type')?.startsWith('multipart/form-data')
			? await req.formData()
			: await req.text()

		temporaryReferences = createTemporaryReferenceSet()
		const args = await decodeReply(body, {
			temporaryReferences,
		})

		const action = await loadServerAction(id)

		try {
			const data = await action.apply(null, args)
			returnValue = { ok: true, data }
		} catch (err) {
			returnValue = { ok: false, data: err }
		}
	} else {
		// otherwise server function is called via
		// <form action={...}>

		// we might have already parsed FormData in the router for multipart action
		// detection should be attached to the DriftRequest, so we can reuse that
		// to avoid parsing twice
		const parsedFormData = req[Drift.Config.REQUEST_META]?.parsedFormData

		const formData = parsedFormData ?? (await req.formData())
		const decodedAction = await decodeAction(formData)
		const result = await decodedAction()
		formState = await decodeFormState(result, formData)
	}

	return { returnValue, formState, temporaryReferences }
}
/**
 * Check if a request is an action request and reuse parsed FormData
 * when multipart action detection already had to inspect the body
 */
export async function maybeActionWithParsedFormData(req: Request) {
	if (req.method !== 'POST') return { action: false, formData: null }
	if (req.headers.has('x-rsc-action-id')) return { action: true, formData: null }

	const contentType = req.headers.get('content-type') ?? ''

	if (!contentType.startsWith('multipart/form-data')) {
		return { action: false, formData: null }
	}

	try {
		const formData = await req.clone().formData()

		for (const key of formData.keys()) {
			if (
				key === '$ACTION_KEY' ||
				key.startsWith('$ACTION_') ||
				key.startsWith('$ACTION_REF_')
			) {
				return { action: true, formData }
			}
		}
	} catch {
		return { action: false, formData: null }
	}

	return { action: false, formData: null }
}

type RuntimeConfig = {
	metadata?: PluginConfig['metadata']
	outDir: NonNullable<PluginConfig['outDir']>
	precompress: NonNullable<PluginConfig['precompress']>
	trailingSlash: NonNullable<PluginConfig['trailingSlash']>
}

/**
 * Create the object exported by the generated RSC entry. Uses the generated config,
 * route manifest, and import map to build the router once, then returns an object
 * with a fetch method that handles requests
 */
export function createHandler(
	config: RuntimeConfig,
	manifest: Manifest,
	importMap: ImportMap,
) {
	const fullyPrerenderedRoutes = new Set<string>(
		Object.values(manifest)
			.flat()
			.filter(entry => 'prerender' in entry && String(entry.prerender) === 'full')
			.map(entry => entry.__path),
	)

	/**
	 * Create the HTTP response for a single incoming request. Runs actions when needed,
	 * converts the payload into component, HTML, or prerender artifact responses, and
	 * applies the final status and headers
	 */
	async function createResponse(req: DriftRequest) {
		let opts: {
			formState?: ReactFormState
			temporaryReferences?: unknown
			returnValue?: { ok: boolean; data: unknown }
		} = {
			formState: undefined,
			temporaryReferences: undefined,
			returnValue: undefined,
		}

		if (req[Drift.Config.REQUEST_META].action) opts = await action(req)

		const {
			stream: rscStream,
			status,
			ppr,
		} = await getPayload(
			req,
			manifest,
			importMap,
			config.metadata,
			opts.returnValue,
			opts.formState,
			opts.temporaryReferences,
		)

		const stream = await rscStream

		if (!req.headers.get('accept')?.includes('text/html')) {
			return new Response(stream, {
				headers: {
					'Cache-Control': 'private, no-store',
					'Content-Type': 'text/x-component; charset=utf-8',
					Vary: 'accept',
				},
				status,
			})
		}

		const mod = await import.meta.viteRsc.loadModule<SSRModule>('ssr', 'index')
		const pathname = new URL(req.url).pathname
		const runtimePpr = !import.meta.env.DEV && ppr

		// prerender artifact requests bypass the normal document path so the cli
		// gets structured JSON instead of a rendered html response
		if (
			req.headers.get('x-drift-prerender') === '1' &&
			req.headers.get('x-drift-prerender-artifact') === '1'
		) {
			const artifact = await mod.prerender(stream, {
				formState: opts.formState,
				ppr: runtimePpr,
				route: pathname,
			})

			return new Response(JSON.stringify(artifact), {
				headers: {
					'Cache-Control': 'private, no-store',
					'Content-Type': 'application/json; charset=utf-8',
					Vary: 'accept',
				},
				status,
			})
		}

		const artifactManifest = runtimePpr
			? await Prerender.Artifact.loadManifest(config.outDir)
			: null
		const artifactManifestEntry = artifactManifest?.routes[pathname] ?? null

		let tryPrelude = false

		if (artifactManifestEntry) {
			tryPrelude = artifactManifestEntry.mode === 'ppr'
		} else if (runtimePpr) {
			const artifactMetadata = await Prerender.Artifact.loadMetadata(
				config.outDir,
				pathname,
			)

			tryPrelude =
				!!artifactMetadata &&
				Prerender.Artifact.isCompatible(artifactMetadata, pathname, 'ppr')
		}

		if (tryPrelude) {
			const postponedState = await Prerender.Artifact.loadPostponedState(
				config.outDir,
				pathname,
			)
			const prelude = await Prerender.Artifact.loadPrelude(config.outDir, pathname)

			// resumable ppr responses splice fresh streamed content into the cached
			// prelude when postponed state is available for this route
			if (postponedState) {
				const resumeStream = await mod.resume(stream, postponedState, {
					nonce: undefined,
					injectPayload: true,
				})

				const body = prelude
					? Prerender.Artifact.composePreludeAndResume(prelude, resumeStream)
					: resumeStream

				return new Response(body, {
					headers: {
						'Cache-Control': 'private, no-store',
						'Content-Type': 'text/html',
						Vary: 'accept',
					},
					status,
				})
			}
		}

		const htmlStream = await mod.ssr(stream, {
			formState: opts.formState,
			ppr: runtimePpr,
		})

		return new Response(htmlStream, {
			headers: {
				'Cache-Control': 'private, no-store',
				'Content-Type': 'text/html',
				Vary: 'accept',
			},
			status,
		})
	}

	const router = createRouter(config, manifest, importMap, createResponse)

	return {
		async fetch(req: Request) {
			const url = new URL(req.url)
			const accept = req.headers.get('accept') ?? ''

			// fully prerendered html can be served straight from disk for normal
			// document requests, but artifact generation must still hit the runtime path
			if (
				!import.meta.env.DEV &&
				accept.includes('text/html') &&
				req.headers.get('x-drift-prerender-artifact') !== '1'
			) {
				const pathname = url.pathname
				let prerenderPath: string | null = null
				const artifactManifest = await Prerender.Artifact.loadManifest(config.outDir)
				const artifactManifestEntry = artifactManifest?.routes[pathname] ?? null

				if (fullyPrerenderedRoutes.has(pathname)) {
					prerenderPath =
						pathname === '/'
							? config.outDir + '/index.html'
							: config.outDir + pathname + '/index.html'
				} else if (artifactManifestEntry) {
					if (artifactManifestEntry.mode === 'full') {
						prerenderPath =
							pathname === '/'
								? config.outDir + '/index.html'
								: config.outDir + pathname + '/index.html'
					}
				} else {
					const artifactMetadata = await Prerender.Artifact.loadMetadata(
						config.outDir,
						pathname,
					)

					if (
						artifactMetadata &&
						Prerender.Artifact.isCompatible(artifactMetadata, pathname, 'full')
					) {
						prerenderPath =
							pathname === '/'
								? config.outDir + '/index.html'
								: config.outDir + pathname + '/index.html'
					}
				}

				if (prerenderPath) {
					const res = await Router.serve(prerenderPath, req, config.precompress, {
						// avoid shared or proxy caching unless users opt into public caching later
						'Cache-Control': 'private, no-store',
						'Content-Type': 'text/html; charset=utf-8',
					})

					if (res.status !== 404) return res
				}
			}

			return router.fetch(req)
		},
	}
}
