import type { ReactFormState } from 'react-dom/client'

import { renderToReadableStream } from '@vitejs/plugin-rsc/rsc'

import { Logger } from '../../utils/logger.js'

import type { ImportMap, Manifest, RuntimeConfig, SolasRequest } from '../../types.js'
import type { SSRModule } from './ssr.js'
import { Solas } from '../../solas.js'
import { createHttpRouter } from '../http-router/create-http-router.js'
import { HttpRouter } from '../http-router/router.js'
import { normalisePathname } from '../http-router/utils.js'
import { Metadata } from '../metadata.js'
import { HttpException, isHttpException } from '../navigation/http-exception.js'
import { Prerender } from '../prerender.js'
import { Tree } from '../render/tree.js'
import { Resolver } from '../resolver.js'
import { processActionRequest } from '../server/actions.js'
import DefaultErr from '../ui/defaults/error.js'
import { RequestContext } from './request-context.js'
import { getKnownDigest, isKnownError } from './utils.js'

export type RscPayload = {
	returnValue?: { ok: boolean; data: unknown }
	formState?: ReactFormState
	root: React.ReactNode
	metadata?: Promise<Metadata.Item>
	url?: {
		pathname?: string
		search?: string
	}
}

/**
 * Create the streamed RSC payload and response metadata for a single request.
 * Resolves the route match, collects metadata, and returns the stream,
 * status code, and prerender mode needed by the response layer
 */
async function createPayload(
	req: SolasRequest,
	manifest: Manifest,
	importMap: ImportMap,
	baseMetadata?: Metadata.Item,
	returnValue?: { ok: boolean; data: unknown },
	formState?: ReactFormState,
	temporaryReferences?: unknown,
) {
	const resolver = new Resolver(manifest, importMap)
	const logger = new Logger()
	const prerender = req.headers.get(`x-${Solas.Config.SLUG}-prerender`) === '1'
	const url = new URL(req.url)
	const pathname =
		url.pathname.endsWith('/') && url.pathname !== '/'
			? url.pathname.slice(0, -1)
			: url.pathname
	const match = resolver.enhance(
		resolver.reconcile(
			pathname,
			req[Solas.Config.REQUEST_META_KEY].match,
			req[Solas.Config.REQUEST_META_KEY].error,
		),
	)

	// if there's no match then no user supplied error boundary
	// has been found, and we should server render a default
	// error screen
	if (!match) {
		const error =
			req[Solas.Config.REQUEST_META_KEY].error ?? new HttpException(404, 'Not found')
		const title = `${'status' in error ? `${error.status} -` : ''}${error.message}`

		const rscPayload: RscPayload = {
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
			url: {
				pathname: url.pathname,
				search: url.search,
			},
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

	const rscPayload: RscPayload = {
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
		url: {
			pathname: url.pathname,
			search: url.search,
		},
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
							url: {
								pathname: url.pathname,
								search: url.search,
							},
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

/**
 * Create the object exported by the generated RSC entry. Uses the generated config,
 * route manifest, and import map to build the router once, then returns an object
 * with a fetch method that handles requests
 */
export function createHandler(
	config: RuntimeConfig,
	manifest: Manifest,
	importMap: ImportMap,
	artifactManifest: Prerender.Artifact.Manifest | null = null,
) {
	const prerenderPathMode = config.trailingSlash === 'always' ? 'always' : 'never'

	/**
	 * Create the HTTP response for a single incoming request. Runs actions when needed,
	 * converts the payload into component, HTML, or prerender artifact responses, and
	 * applies the final status and headers
	 */
	async function createResponse(req: SolasRequest) {
		let opts: {
			formState?: ReactFormState
			temporaryReferences?: unknown
			returnValue?: { ok: boolean; data: unknown }
		} = {
			formState: undefined,
			temporaryReferences: undefined,
			returnValue: undefined,
		}

		if (req[Solas.Config.REQUEST_META_KEY].action) opts = await processActionRequest(req)

		const {
			stream: rscStream,
			status,
			ppr,
		} = await createPayload(
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
		const lookupPath = normalisePathname(pathname, prerenderPathMode)
		const runtimePpr = !import.meta.env.DEV && ppr

		// prerender artifact requests bypass the normal document path so the cli
		// gets structured JSON instead of a rendered html response
		if (
			req.headers.get(`x-${Solas.Config.SLUG}-prerender`) === '1' &&
			req.headers.get(`x-${Solas.Config.SLUG}-prerender-artifact`) === '1'
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

		const artifactManifestEntry = runtimePpr
			? (artifactManifest?.[lookupPath] ?? null)
			: null

		const tryPrelude = artifactManifestEntry?.mode === 'ppr'

		if (tryPrelude) {
			const postponedState = await Prerender.Artifact.loadPostponedState(
				Solas.Config.OUT_DIR,
				lookupPath,
			)
			const prelude = await Prerender.Artifact.loadPrelude(
				Solas.Config.OUT_DIR,
				lookupPath,
			)

			// resumable ppr responses splice fresh streamed content into the cached
			// prelude when postponed state is available for this route
			if (postponedState) {
				// the cached prelude already carries the static payload, only needs to
				// stream the html completions for postponed boundaries
				const resumeStream = await mod.resume(stream, postponedState, {
					nonce: undefined,
					injectPayload: false,
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

	const httpRouter = createHttpRouter(config, manifest, importMap, createResponse)

	// vite-plugin-rsc entrypoint
	return {
		async fetch(req: Request) {
			const url = new URL(req.url)
			const accept = req.headers.get('accept') ?? ''
			const method = req.method.toUpperCase()
			const canonicalPath =
				config.trailingSlash === 'ignore'
					? url.pathname
					: normalisePathname(url.pathname, config.trailingSlash)

			if (
				(method === 'GET' || method === 'HEAD') &&
				config.trailingSlash !== 'ignore' &&
				canonicalPath !== url.pathname
			) {
				url.pathname = canonicalPath
				return Response.redirect(url.toString(), 308)
			}

			// fully prerendered html can be served straight from disk for normal
			// document requests, but build-time artifact requests must bypass
			// this shortcut so they still render fresh output
			if (
				!import.meta.env.DEV &&
				accept.includes('text/html') &&
				req.headers.get(`x-${Solas.Config.SLUG}-prerender-artifact`) !== '1'
			) {
				// turn the request path into the normal route shape we use for artifact lookups
				const lookupPath = normalisePathname(canonicalPath, prerenderPathMode)

				// only full prerender routes have a saved html file we can serve directly
				const prerenderPath =
					artifactManifest?.[lookupPath]?.mode === 'full'
						? Prerender.Artifact.getFilePath(
								Solas.Config.OUT_DIR,
								lookupPath,
								Prerender.Artifact.FULL_PRERENDER_FILENAME,
							)
						: null

				if (prerenderPath) {
					const res = await HttpRouter.serve(prerenderPath, req, config.precompress, {
						// avoid shared or proxy caching unless users opt into public caching later
						'Cache-Control': 'private, no-store',
						'Content-Type': 'text/html; charset=utf-8',
					})

					if (res.status !== 404) return res
				}
			}

			return httpRouter.fetch(req)
		},
	}
}
