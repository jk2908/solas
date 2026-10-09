import type { ReactFormState } from 'react-dom/client'

import { renderToReadableStream } from '@vitejs/plugin-rsc/rsc'

import { applyBasePath, normaliseBasePath, stripBasePath } from '../../utils/base-path.js'
import { Logger } from '../../utils/logger.js'

import type { ImportMap, Manifest, RuntimeConfig, SolasRequest } from '../../types.js'
import type { AssetRef, Assets } from '../runtimes/assets.js'
import type { SSRModule } from './ssr.js'
import * as Config from '../../config.js'
import * as RuntimeManifest from '../../manifest.js'
import { createHttpRouter } from '../http-router/create-http-router.js'
import { HttpRouter } from '../http-router/router.js'
import { normalisePathname } from '../http-router/utils.js'
import { Metadata } from '../metadata.js'
import {
	HttpException,
	isHttpException,
	toHttpException,
	toHttpExceptionLike,
} from '../navigation/http-exception.js'
import { isRedirect, toRedirect } from '../navigation/redirect.js'
import * as Prerender from '../prerender.js'
import { Tree } from '../render/tree.js'
import { Resolver } from '../resolver.js'
import { nodeAssets } from '../runtimes/assets.js'
import { processActionRequest } from '../server/actions.js'
import DefaultErr from '../ui/defaults/error.js'
import { RequestContext } from './request-context.js'
import { getKnownDigest, isKnownError } from './utils.js'

export { loadManifest } from '../../manifest.js'
export type { Assets } from '../runtimes/assets.js'

export type HandlerOptions = {
	/**
	 * Static asset store used to serve prerendered HTML, PPR artifacts, and
	 * client/public files. Defaults to the Node filesystem.
	 */
	assets?: Assets
	/**
	 * The build-time runtime manifest describing which routes were prerendered.
	 */
	runtimeManifest?: RuntimeManifest.Manifest | null
}

export type RscPayload = {
	returnValue?: { ok: boolean; data: unknown }
	formState?: ReactFormState
	root: React.ReactNode
	metadata?: Promise<Metadata.Item>
	url: {
		pathname: string
		search?: string
		hash?: string
	}
}

const logger = new Logger()
const BASE_PATH = normaliseBasePath(import.meta.env.BASE_URL)

/**
 * Resolve a client asset request path to a logical asset reference, rejecting
 * empty, absolute, or traversal paths.
 */
function toClientAsset(relativePath: string): AssetRef | Response {
	try {
		const decoded = decodeURIComponent(relativePath)
			.replace(/\\/g, '/')
			.replace(/^\/+/, '')

		if (!decoded || decoded.split('/').includes('..')) {
			return new Response('Forbidden', { status: 403 })
		}

		return { namespace: 'client', path: decoded }
	} catch {
		return new Response('Bad Request', { status: 400 })
	}
}

/**
 * Create the streamed RSC payload and response metadata for a single request.
 * Resolves the route match, collects metadata, and returns the stream,
 * status code, and prerender mode needed by the response layer.
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
	const prerender = req.headers.get(`x-${Config.SLUG}-prerender`) === '1'
	const url = new URL(req.url)
	const routedPath = stripBasePath(url.pathname, BASE_PATH) ?? url.pathname
	const pathname =
		routedPath.endsWith('/') && routedPath !== '/' ? routedPath.slice(0, -1) : routedPath
	const match = resolver.enhance(
		resolver.reconcile(
			pathname,
			req[Config.REQUEST_META_KEY].match,
			req[Config.REQUEST_META_KEY].error,
		),
	)

	// if there's no match then no user supplied error boundary
	// has been found, and we should server render a default
	// error screen
	if (!match) {
		const error = toHttpExceptionLike(
			req[Config.REQUEST_META_KEY].error ?? new HttpException(404, 'Not found'),
		)

		const title = `${error.status ? `${error.status} -` : ''}${error.message}`

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
				hash: url.hash,
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
						onError,
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
		.add(
			...(match.metadata?.({
				params: match.params,
				error: match.error,
			}) ?? []),
		)
		.run()
	const error = match.error ? toHttpExceptionLike(match.error) : undefined

	const rscPayload: RscPayload = {
		root: (
			<>
				<Tree depth={match.__depth} params={match.params} error={error} ui={match.ui} />
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

	const status = isHttpException(match.error) ? match.error.status : 200

	try {
		const stream = RequestContext.write(
			{
				req,
				prerender: prerender ? (ppr ? 'ppr' : 'full') : null,
				cache: {},
			},
			() =>
				renderToReadableStream(rscPayload, {
					temporaryReferences,
					onError,
				}),
		)

		return { stream, status, ppr }
	} catch (err) {
		logger.error('[rsc:render]', err)

		const title =
			err instanceof Error
				? 'status' in err
					? `${err.status} - ${err.message}`
					: `500 - ${err.message}`
				: '500 - Unknown server error'
		const error = toHttpExceptionLike(
			new Error(err instanceof Error ? err.message : 'Unknown server error', {
				cause: err,
			}),
		)

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
 * with a fetch method that handles requests.
 */
export function createHandler(
	config: RuntimeConfig,
	manifest: Manifest,
	importMap: ImportMap,
	options: HandlerOptions = {},
) {
	const assets = options.assets ?? nodeAssets
	const runtimeManifest = options.runtimeManifest ?? null
	// requests for /_solas and /_solas/* are reserved
	const SOLAS_ASSETS_URL_ROOT = `/${Config.ASSETS_DIR}`

	const prerenderPathMode = config.trailingSlash === 'always' ? 'always' : 'never'

	/**
	 * Create the HTTP response for a single incoming request. Runs actions when needed,
	 * converts the payload into component, HTML, or prerender artifact responses, and
	 * applies the final status and headers.
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

		if (req[Config.REQUEST_META_KEY].action) {
			opts = await processActionRequest(req, {
				trustedOrigins: config.trustedOrigins,
				url: config.url,
			})
		}

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

		async function tryErrorRecovery(err: unknown) {
			if (isRedirect(err)) {
				const redirect = toRedirect(err)
				const location = redirect.url.startsWith('/')
					? new URL(applyBasePath(redirect.url, BASE_PATH), req.url).toString()
					: redirect.url

				return Response.redirect(location, redirect.status)
			}

			if (req[Config.REQUEST_META_KEY].error || !isHttpException(err)) {
				return null
			}

			// retry once with the surfaced HttpException attached so createPayload can
			// rebuild the route through the nearest matching status boundary
			req[Config.REQUEST_META_KEY].error = toHttpException(err)

			try {
				const { stream: retriedRscStream, status: retriedStatus } = await createPayload(
					req,
					manifest,
					importMap,
					config.metadata,
					opts.returnValue,
					opts.formState,
					opts.temporaryReferences,
				)

				const retriedStream = await retriedRscStream

				return {
					retriedStatus,
					retriedStream,
				}
			} finally {
				req[Config.REQUEST_META_KEY].error = undefined
			}
		}

		// prerender artifact requests bypass the normal document path so the cli
		// gets structured JSON instead of a rendered html response
		if (
			req.headers.get(`x-${Config.SLUG}-prerender`) === '1' &&
			req.headers.get(`x-${Config.SLUG}-prerender-artifact`) === '1'
		) {
			try {
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
			} catch (err) {
				const recovered = await tryErrorRecovery(err)
				if (recovered instanceof Response) return recovered

				if (recovered) {
					const artifact = await mod.prerender(recovered.retriedStream, {
						formState: opts.formState,
						ppr: false,
						route: pathname,
					})

					return new Response(JSON.stringify(artifact), {
						headers: {
							'Cache-Control': 'private, no-store',
							'Content-Type': 'application/json; charset=utf-8',
							Vary: 'accept',
						},
						status: recovered.retriedStatus,
					})
				}

				throw err
			}
		}

		try {
			const artifactEntry = runtimePpr
				? (runtimeManifest?.artifacts[lookupPath] ?? null)
				: null

			const tryPrelude = artifactEntry?.mode === 'ppr'

			if (tryPrelude) {
				const postponedState = await Prerender.loadPostponedState(lookupPath, assets)
				const prelude = await Prerender.loadPrelude(lookupPath, assets)

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
						? Prerender.composePreludeAndResume(prelude, resumeStream)
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
		} catch (err) {
			const recovered = await tryErrorRecovery(err)
			if (recovered instanceof Response) return recovered

			if (recovered) {
				const retriedHtmlStream = await mod.ssr(recovered.retriedStream, {
					formState: opts.formState,
					ppr: false,
				})

				return new Response(retriedHtmlStream, {
					headers: {
						'Cache-Control': 'private, no-store',
						'Content-Type': 'text/html',
						Vary: 'accept',
					},
					status: recovered.retriedStatus,
				})
			}

			throw err
		}
	}

	const httpRouter = createHttpRouter(config, manifest, importMap, createResponse)

	// vite-plugin-rsc entrypoint
	return {
		async fetch(req: Request) {
			const url = new URL(req.url)
			const method = req.method.toUpperCase()

			// fast path
			if (method !== 'GET' && method !== 'HEAD') return httpRouter.fetch(req)

			const accept = req.headers.get('accept') ?? ''
			const routedPath = stripBasePath(url.pathname, BASE_PATH)
			const canonicalPath =
				routedPath == null
					? null
					: config.trailingSlash === 'ignore'
						? routedPath
						: normalisePathname(routedPath, config.trailingSlash)
			const canonicalPathname =
				canonicalPath == null ? null : applyBasePath(canonicalPath, BASE_PATH)

			if (
				canonicalPathname != null &&
				(method === 'GET' || method === 'HEAD') &&
				config.trailingSlash !== 'ignore' &&
				canonicalPathname !== url.pathname
			) {
				url.pathname = canonicalPathname
				return Response.redirect(url.toString(), 308)
			}

			// block the bare /_solas namespace; only concrete solas asset files
			// under /_solas/* are valid
			if (routedPath === SOLAS_ASSETS_URL_ROOT) {
				return new Response('Forbidden', { status: 403 })
			}

			if (routedPath?.startsWith(`${SOLAS_ASSETS_URL_ROOT}/`)) {
				const asset = toClientAsset(
					`${Config.ASSETS_DIR}/${routedPath.slice(`${SOLAS_ASSETS_URL_ROOT}/`.length)}`,
				)

				// pass through bad-request or forbidden responses from path resolution
				if (asset instanceof Response) return asset

				return HttpRouter.serveStatic(assets, asset, req, config.precompress, {
					'Cache-Control': 'public, immutable, max-age=31536000',
				})
			}

			if (routedPath && runtimeManifest?.publicFiles.has(routedPath)) {
				const asset = toClientAsset(routedPath.slice(1))

				// pass through bad-request or forbidden responses from path resolution
				if (asset instanceof Response) return asset

				return HttpRouter.serveStatic(assets, asset, req, config.precompress)
			}

			// fully prerendered html can be served straight from disk for normal
			// document requests, but build-time artifact requests must bypass
			// this shortcut so they still render fresh output
			if (
				canonicalPath != null &&
				!import.meta.env.DEV &&
				accept.includes('text/html') &&
				req.headers.get(`x-${Config.SLUG}-prerender-artifact`) !== '1'
			) {
				// turn the request path into the normal route shape we use for artifact lookups
				const lookupPath = normalisePathname(canonicalPath, prerenderPathMode)

				// only full prerender routes have a saved html file we can serve directly
				const staticAsset: AssetRef | null =
					runtimeManifest?.artifacts[lookupPath]?.mode === 'full'
						? {
								namespace: 'static',
								path: Prerender.staticRoutePath(lookupPath, prerenderPathMode),
							}
						: null

				if (staticAsset) {
					const res = await HttpRouter.serveStatic(
						assets,
						staticAsset,
						req,
						config.precompress,
						{
							// fully prerendered routes are immutable per build, so allow them
							// to be cached and revalidated instead of forcing no-store
							'Cache-Control': 'public, max-age=0, must-revalidate',
							'Content-Type': 'text/html; charset=utf-8',
						},
					)

					// only a missing prerendered file should fall back to normal request handling
					// any other static-file response should be returned as-is
					if (res.status !== 404) return res
				}
			}

			return httpRouter.fetch(req)
		},
	}
}

/**
 * Build a Solas request handler over an {@link Assets} store.
 *
 * Loads the runtime manifest and constructs the RSC handler, defaulting to the
 * Node standard library for assets. Platform adapters pass their own store (for
 * example the Cloudflare `ASSETS` binding), so the same generated entry runs
 * unchanged across runtimes.
 */
export async function createRuntimeHandler(
	config: RuntimeConfig,
	manifest: Manifest,
	importMap: ImportMap,
	assets: Assets = nodeAssets,
) {
	const runtimeManifest = await RuntimeManifest.loadManifest(assets)

	return createHandler(config, manifest, importMap, { assets, runtimeManifest })
}

function onError(err: unknown) {
	if (err == null) return

	const digest = getKnownDigest(err)

	if (digest) return digest
	if (isKnownError(err)) return

	logger.error('[rsc]', err)
}
