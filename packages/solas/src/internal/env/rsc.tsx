import type { ReactFormState } from 'react-dom/client'

import { renderToReadableStream } from '@vitejs/plugin-rsc/rsc'

import { applyBasePath, normaliseBasePath, stripBasePath } from '../../utils/base-path.js'
import { Logger } from '../../utils/logger.js'
import { normalisePath } from '../../utils/path.js'

import type {
	ImportMap,
	Manifest,
	Route,
	RuntimeConfig,
	SolasRequest,
} from '../../types.js'
import type { AssetRef, Assets } from '../assets.js'
import type { RscSegment, RscSegmentDescriptor } from '../route-segments.js'
import type { SSRModule } from './ssr.js'
import * as Config from '../../config.js'
import * as RuntimeManifest from '../../manifest.js'
import { nodeAssets } from '../assets.js'
import { addHashesToPolicy, buildPolicy, resolveNonce } from '../csp.js'
import { createHttpRouter } from '../http-router/create-http-router.js'
import { HttpRouter } from '../http-router/router.js'
import {
	isRscRequest,
	normaliseTrailingSlash,
	resolveRequestPath,
} from '../http-router/utils.js'
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
import { processActionRequest } from '../server/actions.js'
import { createHeaderResolver } from '../server/headers.js'
import { drainRevalidatedPaths } from '../server/revalidate.js'
import DefaultErr from '../ui/defaults/error.js'
import { RequestContext } from './request-context.js'
import { getKnownDigest, isKnownError } from './utils.js'

export { loadManifest } from '../../manifest.js'
export type { Assets } from '../assets.js'

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
	/**
	 * Development-only route CSS plan. Production uses the runtime manifest.
	 */
	devClientCssByRoute?: Record<string, string[]>
}

export type { RscSegment, RscSegmentDescriptor } from '../route-segments.js'

export type RscPayload = {
	returnValue?: { ok: boolean; data: unknown }
	formState?: ReactFormState
	root: React.ReactNode
	clientCss?: string[]
	metadata?: Promise<Metadata.Item>
	type?: Route.PrerenderMode | 'dynamic'
	segments?: RscSegment
	segmentable?: boolean
	params?: Record<string, string | string[]>
	cache?: {
		layouts?: number | null
		page?: number | null
		invalidatedPaths?: { path: string; scope: 'page' | 'layout' }[]
	}
	url: {
		pathname: string
		search?: string
		hash?: string
	}
}

const logger = new Logger()
const BASE_PATH = normaliseBasePath(import.meta.env.BASE_URL)
const nullBodyStatuses = new Set([101, 204, 205, 304])
const DEFAULT_PAGE_STALE_MS = 30_000

function normaliseParams(params: Record<string, unknown> | undefined) {
	return params === undefined
		? {}
		: Object.fromEntries(
				Object.keys(params)
					.sort()
					.map(key => [key, params[key]]),
			)
}

function sameParams(
	a: Record<string, unknown> | undefined,
	b: Record<string, unknown> | undefined,
) {
	return JSON.stringify(normaliseParams(a)) === JSON.stringify(normaliseParams(b))
}

function parseRouterState(value: string | null) {
	if (!value) return null

	try {
		const parsed = JSON.parse(value) as {
			segments?: unknown
			params?: unknown
			cachedLayouts?: unknown
		}
		if (!Array.isArray(parsed.segments)) return null

		const segments: RscSegmentDescriptor[] = []

		for (const segment of parsed.segments) {
			if (!segment || typeof segment !== 'object') return null

			const { id, kind } = segment as { id?: unknown; kind?: unknown }
			if (typeof id !== 'string') return null
			if (kind !== 'shell' && kind !== 'layout' && kind !== 'page') return null

			segments.push({ id, kind })
		}

		let params: Record<string, string | string[]> | undefined
		if (parsed.params !== undefined) {
			if (!parsed.params || typeof parsed.params !== 'object') return null
			params = {}

			for (const [key, value] of Object.entries(parsed.params)) {
				if (typeof value === 'string') {
					params[key] = value
					continue
				}

				if (Array.isArray(value) && value.every(item => typeof item === 'string')) {
					params[key] = value
					continue
				}

				return null
			}
		}

		let cachedLayouts: string[] | undefined
		if (parsed.cachedLayouts !== undefined) {
			if (
				!Array.isArray(parsed.cachedLayouts) ||
				!parsed.cachedLayouts.every(id => typeof id === 'string')
			) {
				return null
			}

			cachedLayouts = parsed.cachedLayouts
		}

		return { segments, params, cachedLayouts }
	} catch {
		return null
	}
}

/**
 * Work out which layout nodes a patch still needs. The client supplies its
 * current tree and cached layout IDs; unchanged cached nodes are omitted.
 */
function requiredLayoutIds(
	state: ReturnType<typeof parseRouterState>,
	layoutIds: (string | null)[],
	params: Record<string, string | string[]> | undefined,
) {
	const target = layoutIds.filter((id): id is string => typeof id === 'string')

	if (!state) return target

	const current = state.segments
		.filter(segment => segment.kind !== 'page')
		.map(segment => segment.id)
	const paramsChanged = !sameParams(state.params, params)
	const cached = new Set(state.cachedLayouts ?? [])

	let firstChanged = target.length

	if (!paramsChanged) {
		for (let index = 0; index < target.length; index++) {
			if (current[index] !== target[index]) {
				firstChanged = index
				break
			}
		}
	}

	return target.filter(
		(id, index) => paramsChanged || index >= firstChanged || !cached.has(id),
	)
}

/**
 * Resolve a client asset request path to a logical asset reference, rejecting
 * empty, absolute, or traversal paths.
 */
function toClientAsset(relativePath: string): AssetRef | Response {
	try {
		const decoded = normalisePath(decodeURIComponent(relativePath)).replace(/^\/+/, '')

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
async function createPayload({
	request,
	manifest,
	importMap,
	baseMetadata,
	returnValue,
	formState,
	temporaryReferences,
	nonce,
	clientCssByRoute,
	effectivePrerenderMode,
	assets,
	invalidatedPaths,
}: {
	request: SolasRequest
	manifest: Manifest
	importMap: ImportMap
	baseMetadata?: Metadata.Item
	returnValue?: { ok: boolean; data: unknown }
	formState?: ReactFormState
	temporaryReferences?: unknown
	nonce?: string
	clientCssByRoute?: Record<string, string[]>
	effectivePrerenderMode?: Route.PrerenderMode
	assets?: Assets
	invalidatedPaths?: { path: string; scope: 'page' | 'layout' }[]
}) {
	const resolver = new Resolver(manifest, importMap)
	const prerender = request.headers.get(`x-${Config.SLUG}-prerender`) === '1'
	const url = new URL(request.url)
	const routedPath = stripBasePath(url.pathname, BASE_PATH) ?? url.pathname

	const pathname =
		routedPath.endsWith('/') && routedPath !== '/' ? routedPath.slice(0, -1) : routedPath

	const reconciled = resolver.reconcile(
		pathname,
		request[Config.REQUEST_META_KEY].match,
		request[Config.REQUEST_META_KEY].error,
	)
	const prefetch = request.headers.get(`x-${Config.SLUG}-prefetch`) === '1'
	const routerState = parseRouterState(
		request.headers.get(`x-${Config.SLUG}-router-state`),
	)
	const segmentType = request.headers.get(`x-${Config.SLUG}-segment`)
	const shellSegment = segmentType === 'shell'
	const patchSegment = segmentType === 'patch'
	const prerenderMode = effectivePrerenderMode ?? reconciled?.prerender
	const routeType: Route.PrerenderMode | 'dynamic' =
		prerenderMode === 'full' ? 'full' : prerenderMode === 'ppr' ? 'ppr' : 'dynamic'

	// ppr prefetches render the static layout shell with a page slot; dynamic
	// routes still prefetch in full
	const shell =
		(prefetch || shellSegment) &&
		!patchSegment &&
		prerenderMode === 'ppr' &&
		!reconciled?.error

	const match = resolver.enhance(reconciled)

	// build-time prerender requests have no request nonce, and full routes are
	// served from static HTML. PPR responses are dynamic: the cached prelude uses
	// hashes, while the resumed holes need the request nonce.
	const effectiveNonce = prerender || routeType === 'full' ? undefined : nonce

	const matchedClientCss = match ? (clientCssByRoute?.[match.__path] ?? []) : []
	const patchLayouts =
		patchSegment && match
			? requiredLayoutIds(routerState, match.paths.layouts, match.params)
			: undefined
	const segmentHeads =
		patchSegment && match?.metadataSegments
			? match
					.metadataSegments({ params: match.params, error: match.error })
					.map(({ id, tasks }) => ({
						id,
						metadata: new Metadata.Collection(baseMetadata).add(...tasks).run(),
					}))
			: undefined

	// completed build shells already contain the static layouts, page content
	// and suspended fallbacks, so navigations can commit them immediately
	const shellArtifact =
		match && shell && (prefetch || shellSegment)
			? await Prerender.loadShell(pathname, assets)
			: null

	if (shellArtifact) {
		const encoder = new TextEncoder()

		return {
			stream: new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(encoder.encode(shellArtifact))
					controller.close()
				},
			}),
			status: 200,
			ppr: true,
			nonce: effectiveNonce,
			type: 'ppr' as const,
			segment: 'shell' as const,
		}
	}

	// if there's no match then no user supplied error boundary
	// has been found, and we should server render a default
	// error screen
	if (!match) {
		const error = toHttpExceptionLike(
			request[Config.REQUEST_META_KEY].error ?? new HttpException(404, 'Not found'),
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
			clientCss: matchedClientCss,
			url: {
				pathname: url.pathname,
				search: url.search,
				hash: url.hash,
			},
		}

		return {
			// this path is a safety fallback when a prerender request
			// hits an unmatched route. In build prerender we force
			// mode to `full` so the 404/error shell resolves
			// immediately. In normal request-time rendering
			// we keep mode as null
			stream: RequestContext.write(
				{
					request,
					prerender: prerender ? 'full' : null,
					cache: {},
					nonce: effectiveNonce,
				},
				() =>
					renderToReadableStream(rscPayload, {
						temporaryReferences,
						onError,
					}),
			),
			status: 404,
			ppr: false,
			nonce: effectiveNonce,
			type: routeType,
			segment: false,
		}
	}

	// check if this route is a candidate for ppr
	const ppr = routeType === 'ppr'
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

	const root = (
		<Tree
			depth={match.__depth}
			params={match.params}
			error={error}
			ui={match.ui}
			layoutIds={match.paths.layouts}
			shell={shell && !patchSegment}
			patch={patchSegment}
			layoutFilter={patchLayouts}
			pageId={match.paths.page}
			segmentHeads={segmentHeads}
		/>
	)

	const rscPayload: RscPayload = {
		root,
		returnValue,
		formState,
		clientCss: matchedClientCss,
		metadata,
		type: routeType,
		segments: {
			layouts: match.paths.layouts,
			page: match.paths.page ?? null,
		},
		segmentable: shell,
		params: match.params,
		cache: {
			...(patchSegment ? { layouts: null, page: DEFAULT_PAGE_STALE_MS } : {}),
			...(invalidatedPaths && invalidatedPaths.length > 0 ? { invalidatedPaths } : {}),
		},
		url: {
			pathname: url.pathname,
			search: url.search,
		},
	}

	const status = isHttpException(match.error) ? match.error.status : 200

	try {
		const stream = RequestContext.write(
			{
				request,
				prerender: prerender ? (ppr ? 'ppr' : 'full') : null,
				cache: {},
				nonce: effectiveNonce,
			},
			() =>
				renderToReadableStream(rscPayload, {
					temporaryReferences,
					onError,
				}),
		)

		return {
			stream,
			status,
			ppr,
			nonce: effectiveNonce,
			type: routeType,
			segment: patchSegment ? ('patch' as const) : false,
		}
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
					request,
					prerender: prerender ? 'full' : null,
					cache: {},
					nonce: effectiveNonce,
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
							clientCss: matchedClientCss,
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
			nonce: effectiveNonce,
			type: routeType,
			segment: false,
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
	const clientCssByRoute =
		runtimeManifest?.clientCssByRoute ?? options.devClientCssByRoute ?? {}
	// requests for /_solas and /_solas/* are reserved
	const SOLAS_ASSETS_URL_ROOT = `/${Config.ASSETS_DIR}`

	const prerenderPathMode = config.trailingSlash === 'always' ? 'always' : 'never'

	const resolveHeaders = createHeaderResolver(config.headers)
	const responseNonce = new WeakMap<Request, string>()
	const clientStyleHashes = [
		...new Set(
			Object.values(runtimeManifest?.artifacts ?? {}).flatMap(
				artifact => artifact.csp?.style ?? [],
			),
		),
	]

	/**
	 * Create the HTTP response for a single incoming request. Runs actions when needed,
	 * converts the payload into component, HTML, or prerender artifact responses, and
	 * applies the final status and headers.
	 */
	async function createResponse(request: SolasRequest) {
		let opts: {
			formState?: ReactFormState
			temporaryReferences?: unknown
			returnValue?: { ok: boolean; data: unknown }
		} = {
			formState: undefined,
			temporaryReferences: undefined,
			returnValue: undefined,
		}

		if (request[Config.REQUEST_META_KEY].action) {
			opts = await processActionRequest(request, {
				trustedOrigins: config.trustedOrigins,
				url: config.url,
			})
		}

		const invalidatedPaths = request[Config.REQUEST_META_KEY].action
			? drainRevalidatedPaths()
			: undefined

		const requestCsp = request.headers.get('content-security-policy')
		const configuredHeaders = await resolveHeaders(request)

		const clientNonce =
			isRscRequest(request) || request[Config.REQUEST_META_KEY].action
				? request.headers.get('x-solas-nonce')
				: null

		const generatedNonce =
			config.csp && !requestCsp ? clientNonce || crypto.randomUUID() : undefined

		if (config.csp && generatedNonce) {
			responseNonce.set(request, generatedNonce)
		}

		const nonce = requestCsp
			? resolveNonce(requestCsp, configuredHeaders, clientNonce)
			: (generatedNonce ?? resolveNonce(null, configuredHeaders, clientNonce))

		const requestPathname = new URL(request.url).pathname
		const requestLookupPath = normaliseTrailingSlash(requestPathname, prerenderPathMode)
		const effectivePrerenderMode = runtimeManifest?.artifacts[requestLookupPath]?.mode
		const {
			stream: rscStream,
			status,
			ppr,
			nonce: effectiveNonce,
			type,
			segment,
		} = await createPayload({
			request,
			manifest,
			importMap,
			baseMetadata: config.metadata,
			returnValue: opts.returnValue,
			formState: opts.formState,
			temporaryReferences: opts.temporaryReferences,
			nonce,
			clientCssByRoute,
			effectivePrerenderMode,
			assets,
			invalidatedPaths,
		})

		const stream = await rscStream

		if (nullBodyStatuses.has(status)) {
			return new Response(null, {
				headers: {
					[`x-${Config.SLUG}-route-type`]: type,
					'Cache-Control': 'private, no-store',
					Vary: 'accept',
				},
				status,
			})
		}

		if (isRscRequest(request)) {
			return new Response(stream, {
				headers: {
					[`x-${Config.SLUG}-route-type`]: type,
					...(segment ? { [`x-${Config.SLUG}-segment`]: segment } : {}),
					'Cache-Control': 'private, no-store',
					'Content-Type': 'text/x-component; charset=utf-8',
					Vary: 'accept',
				},
				status,
			})
		}

		const mod = await import.meta.viteRsc.loadModule<SSRModule>('ssr', 'index')
		const pathname = requestPathname
		const lookupPath = requestLookupPath
		const runtimePpr = !import.meta.env.DEV && ppr

		async function tryErrorRecovery(err: unknown) {
			if (isRedirect(err)) {
				const redirect = toRedirect(err)

				const location = redirect.url.startsWith('/')
					? new URL(applyBasePath(redirect.url, BASE_PATH), request.url).toString()
					: redirect.url

				return Response.redirect(location, redirect.status)
			}

			if (request[Config.REQUEST_META_KEY].error || !isHttpException(err)) {
				return null
			}

			// retry once with the surfaced HttpException attached so createPayload can
			// rebuild the route through the nearest matching status boundary
			request[Config.REQUEST_META_KEY].error = toHttpException(err)

			try {
				const { stream: retriedRscStream, status: retriedStatus } = await createPayload({
					request,
					manifest,
					importMap,
					baseMetadata: config.metadata,
					returnValue: opts.returnValue,
					formState: opts.formState,
					temporaryReferences: opts.temporaryReferences,
					nonce,
					clientCssByRoute,
					effectivePrerenderMode,
					assets,
					invalidatedPaths,
				})

				const retriedStream = await retriedRscStream

				return {
					retriedStatus,
					retriedStream,
				}
			} finally {
				request[Config.REQUEST_META_KEY].error = undefined
			}
		}

		// prerender artifact requests bypass the normal document path so the
		// prerenderer gets structured JSON instead of a rendered html response
		if (
			request.headers.get(`x-${Config.SLUG}-prerender`) === '1' &&
			request.headers.get(`x-${Config.SLUG}-prerender-artifact`) === '1'
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
						nonce: effectiveNonce,
						injectPayload: false,
					})

					const body = prelude
						? Prerender.composePreludeAndResume(prelude, resumeStream, effectiveNonce)
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
				nonce: effectiveNonce,
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
					nonce: effectiveNonce,
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

	/**
	 * Serve the saved HTML for a fully prerendered route. Runs as the route
	 * handler, after middleware, so middleware applies to static routes too. It
	 * returns null for anything else (a route without a saved prerender or an RSC
	 * navigation), so the caller falls back to rendering.
	 */
	async function serveFullPrerender(req: Request) {
		if (import.meta.env.DEV) return null
		if (isRscRequest(req)) return null
		if (req.headers.get(`x-${Config.SLUG}-prerender-artifact`) === '1') return null
		if (!runtimeManifest) return null

		const routedPath = stripBasePath(new URL(req.url).pathname, BASE_PATH)
		if (routedPath == null) return null

		const lookupPath = normaliseTrailingSlash(routedPath, prerenderPathMode)
		if (runtimeManifest.artifacts[lookupPath]?.mode !== 'full') return null

		const res = await HttpRouter.serveStatic(
			assets,
			{
				namespace: 'static',
				path: Prerender.staticRoutePath(lookupPath, prerenderPathMode),
			},
			req,
			config.precompress,
			{
				// fully prerendered routes are immutable per build, so allow them
				// to be cached and revalidated instead of forcing no-store
				'Cache-Control': 'public, max-age=0, must-revalidate',
				'Content-Type': 'text/html; charset=utf-8',
			},
		)

		return res.status === 404 ? null : res
	}

	const httpRouter = createHttpRouter(
		config,
		manifest,
		importMap,
		createResponse,
		serveFullPrerender,
	)

	/**
	 * Hash sources for a prerendered document. The route's own scripts are
	 * immutable, while the union of prerendered styles also covers style tags a
	 * client navigation can insert from another route.
	 */
	function getCspHashes(req: Request, res: Response) {
		if (!runtimeManifest) return

		const contentType = res.headers.get('content-type')

		if (!contentType?.toLowerCase().startsWith('text/html')) return

		const routedPath = stripBasePath(new URL(req.url).pathname, BASE_PATH)

		if (routedPath == null) return

		const lookupPath = normaliseTrailingSlash(routedPath, prerenderPathMode)
		const artifact = runtimeManifest.artifacts[lookupPath]

		if (!artifact?.csp) return

		return {
			script: artifact.csp.script,
			style: [...new Set([...artifact.csp.style, ...clientStyleHashes])],
		}
	}

	/**
	 * Add the configured `headers` and any prerender CSP hashes to a response.
	 * Clones the response so immutable ones (redirects, cached assets) can still
	 * be augmented.
	 */
	async function withHeaders(res: Response, req: Request) {
		const headers = new Headers(res.headers)
		let changed = false

		if (config.headers) {
			const entries = await resolveHeaders(req)
			const requestCsp = req.headers.get('content-security-policy')

			for (const [key, value] of Object.entries(entries)) {
				if (requestCsp && key.toLowerCase() === 'content-security-policy') continue

				headers.set(key, value)
				changed = true
			}
		}

		const hashes = getCspHashes(req, res)
		const isHtml = res.headers.get('content-type')?.toLowerCase().startsWith('text/html')
		const nonce = responseNonce.get(req)

		if (config.csp && !req.headers.has('content-security-policy') && isHtml) {
			const built = buildPolicy(config.csp.directives, { nonce, hashes })

			if (built) {
				headers.set('content-security-policy', built)
				changed = true
			}
		}

		const csp = headers.get('content-security-policy')

		if (hashes && csp) {
			const updated = addHashesToPolicy(csp, hashes)

			if (updated !== csp) {
				headers.set('content-security-policy', updated)
				changed = true
			}
		}

		if (!changed) return res

		return new Response(res.body, {
			status: res.status,
			statusText: res.statusText,
			headers,
		})
	}

	async function dispatch(req: Request) {
		const url = new URL(req.url)
		const method = req.method.toUpperCase()

		// fast path
		if (method !== 'GET' && method !== 'HEAD') return httpRouter.fetch(req)

		const {
			routedPath,
			path: canonicalPath,
			pathname: canonicalPathname,
		} = resolveRequestPath(url.pathname, BASE_PATH, config.trailingSlash)

		if (
			canonicalPathname != null &&
			(method === 'GET' || method === 'HEAD') &&
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

		// the path is already canonical here: a mismatched shape redirected above,
		// so hand the resolved path to the router rather than letting it recompute
		// the base path and trailing slash a second time
		return httpRouter.fetch(req, canonicalPath)
	}

	// vite-plugin-rsc entrypoint
	return {
		async fetch(req: Request) {
			return withHeaders(await dispatch(req), req)
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
export type RuntimeHandlerOptions = HandlerOptions & {
	config: RuntimeConfig
	manifest: Manifest
	importMap: ImportMap
}

export async function createRuntimeHandler(options: RuntimeHandlerOptions) {
	const { config, manifest, importMap, assets = nodeAssets, ...handlerOptions } = options

	// development renders from source; do not pick up stale build artifacts
	// left in dist/.solas by a previous production build
	const runtimeManifest = import.meta.env.DEV
		? null
		: await RuntimeManifest.loadManifest(assets)

	return createHandler(config, manifest, importMap, {
		...handlerOptions,
		assets,
		runtimeManifest,
	})
}

function onError(err: unknown) {
	if (err == null) return

	const digest = getKnownDigest(err)

	if (digest) return digest
	if (isKnownError(err)) return

	logger.error('[rsc]', err)
}
