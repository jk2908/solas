'use client'
import {
	createContext,
	Suspense,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react'

import { createFromReadableStream } from '@vitejs/plugin-rsc/browser'

import { getDocumentNonce } from '../../utils/get-document-nonce.js'
import { Logger, createLogger } from '../../utils/logger.js'

import type { BrowserConfig } from '../../types.js'
import type { RscPayload } from '../env/rsc.js'
import * as Config from '../../config.js'
import * as Events from '../../events.js'
import { Head } from '../render/head.js'
import {
	ExternalUrlError,
	InvalidNavigationPayloadError,
	InvalidNavigationUrlError,
	isBrowserRouterError,
	isRouteTargetError,
} from './errors.js'
import { BrowserRouterHistory } from './history.js'
import { LayoutCache } from './layout-cache.js'
import { PrefetchObserverProvider } from './prefetch-observer.js'
import {
	createRevalidationChannel,
	readInvalidatedPaths,
	type InvalidatedPath,
} from './revalidation.js'
import { isRouterCacheEntryType, RouterCache } from './router-cache.js'
import { buildRouterTree } from './router-state.js'
import { collectSegments, SegmentContext, type SegmentMeta } from './segment-slot.js'
import * as BrowserRouter from './shared.js'

export * as BrowserRouter from './shared.js'

export const BrowserRouterContext = createContext<BrowserRouter.Context>({
	go: async () => '',
	evict: () => {},
	prefetch: () => {},
	refresh: async () => '',
	isNavigating: false,
	url: {
		pathname: '',
		search: '',
		hash: '',
	},
	history: {
		entries: [],
		index: -1,
	},
})

export const BrowserRouterActionsContext = createContext<
	Pick<BrowserRouter.Context, 'go' | 'prefetch'>
>({
	go: async () => '',
	prefetch: () => {},
})

const DEFAULT_GO_CONFIG = {
	replace: false,
} satisfies BrowserRouter.GoOptions

const logger = createLogger('router')

const STATIC = import.meta.env.SOLAS_ADAPTER === 'static'

/**
 * The URL to fetch the response for a navigation. On a static host that is the
 * pre-generated RSC payload; otherwise the path itself carries the RSC response
 * for an `Accept: text/x-component` request.
 */
function getPayloadUrl(path: string) {
	const url = new URL(path, window.location.origin)

	url.pathname = url.pathname.endsWith('/')
		? `${url.pathname}index.rsc.txt`
		: `${url.pathname}.rsc.txt`

	url.search = ''

	return url
}

/**
 * Read the route mode advertised by an RSC response.
 */
function readRouteType(res: Response) {
	const type = res.headers.get(`x-${Config.SLUG}-route-type`)
	return isRouterCacheEntryType(type) ? type : undefined
}

/**
 * Begin decoding an RSC response while counting its bytes in parallel.
 *
 * `payload` resolves when the root RSC tree is ready to render. Deferred
 * Suspense content may still be streaming at that point.
 *
 * `bytes` resolves only when the full body has arrived and the final byte
 * count is available for cache accounting.
 *
 * Navigation can await `payload` for an immediate render, while cache
 * promotion can await `bytes` without delaying the UI.
 */
function decodeRscResponse(res: Response) {
	const type = readRouteType(res)
	const segmentHeader = res.headers.get(`x-${Config.SLUG}-segment`)
	const segment =
		segmentHeader === 'shell' || segmentHeader === 'patch' ? segmentHeader : null

	// null-body responses have nothing to decode or cache
	if (res.status === 204 || !res.ok || !res.body) return null

	let byteCount = 0
	let finish: () => void

	// the count is only known once the body has fully streamed
	const bytes = new Promise<number>(resolve => {
		finish = () => resolve(byteCount)
	})

	const body = res.body.pipeThrough(
		new TransformStream<Uint8Array, Uint8Array>({
			transform(chunk, controller) {
				// count without copying the chunk or buffering the response
				byteCount += chunk.byteLength
				controller.enqueue(chunk)
			},
			flush() {
				finish()
			},
		}),
	)

	// the parser consumes the counted stream and can resolve the payload before
	// the stream closes. Shell artifacts were produced as prerender results, so
	// mark them as segmentable when they are used for client navigation.
	const payload = (async () => {
		const payload = await createFromReadableStream<RscPayload>(body)

		if (segment === 'shell') payload.segmentable = true

		return payload
	})()

	return { payload, bytes, url: res.url, type, segment }
}

/**
 * Fetch the RSC representation for a client navigation or prefetch.
 *
 * Static hosts use pre-generated payload files instead of making a server
 * request.
 */
function performNavigationFetch(path: string, init?: RequestInit) {
	// fully prerendered static deployments read their pre-generated payload
	if (STATIC) return fetch(getPayloadUrl(path), init)

	const headers = new Headers(init?.headers)
	// ask the server for the RSC representation rather than a document
	headers.set('accept', 'text/x-component')

	// reuse the document nonce so inline payload scripts satisfy CSP
	const nonce = getDocumentNonce()
	if (nonce) headers.set('x-solas-nonce', nonce)

	return fetch(path, { ...init, headers })
}

const MAX_HASH_ATTEMPTS = 20

/**
 * Scroll to the element a hash points at, retrying for a few frames because the
 * incoming tree may still be committing when the navigation resolves.
 */
function scrollToHash(hash: string, attempts = MAX_HASH_ATTEMPTS) {
	let id: string

	try {
		id = decodeURIComponent(hash.replace(/^#/, ''))
	} catch {
		id = hash.replace(/^#/, '')
	}

	if (!id) {
		window.scrollTo(0, 0)
		return
	}

	const element = document.getElementById(id) ?? document.getElementsByName(id)[0] ?? null

	if (element) {
		element.scrollIntoView()
		return
	}

	if (attempts <= 0) return

	requestAnimationFrame(() => scrollToHash(hash, attempts - 1))
}

/**
 * Reset focus to the document body after a client navigation, matching the
 * browser behavior of a full page load.
 */
function resetFocusAfterNavigation() {
	if (typeof document === 'undefined') return

	if (!document.body.hasAttribute('tabindex')) {
		document.body.setAttribute('tabindex', '-1')
	}

	document.body.focus({ preventScroll: true })
}

function applyScroll(intent: BrowserRouter.ScrollIntent, hash: string) {
	if (typeof window === 'undefined') return
	if (intent === 'none') return
	if (typeof window.scrollTo !== 'function') return

	if (typeof intent === 'object') {
		// wait for the restored tree to commit so it has its full height
		requestAnimationFrame(() =>
			requestAnimationFrame(() => window.scrollTo(0, intent.restore)),
		)
		return
	}

	if (hash) {
		scrollToHash(hash)
		return
	}

	window.scrollTo(0, 0)
}

/**
 * Resolve the layout nodes needed by a target chain. Cached nodes are reused;
 * request-time nodes are stored according to the payload cache policy.
 */
function resolveLayoutNodes(
	cache: LayoutCache,
	layoutNodes: Map<string, React.ReactNode>,
	layoutIds: string[],
	params: RscPayload['params'],
	cachePolicy: RscPayload['cache'],
	path: string,
	defaultTtl: number,
) {
	const expiresAt =
		cachePolicy?.layouts === null
			? Number.POSITIVE_INFINITY
			: Date.now() + (cachePolicy?.layouts ?? defaultTtl)
	const dynamic = new Set(cachePolicy?.dynamicLayouts ?? [])
	const values = new Map<string, React.ReactNode>()

	for (const id of layoutIds) {
		const isDynamic = dynamic.has(id)
		const cached = isDynamic ? undefined : cache.get(id, params)

		if (cached) {
			cache.touch(id, params, path)
			values.set(id, cached.value)
			continue
		}

		const value = layoutNodes.get(id)
		if (value === undefined) continue

		values.set(id, value)

		// dynamic layouts are request data; their static descendants stay cacheable
		if (!isDynamic) cache.set(id, params, value, { expiresAt, path })
	}

	return values
}

export function BrowserRouterProvider({
	children,
	setPayload,
	isNavigating = false,
	url,
	metadata,
	clientCss,
	clientJs,
	segments,
	params,
	config = {},
}: {
	children: React.ReactNode
	setPayload?: (payload: RscPayload) => void
	isNavigating?: boolean
	url: {
		pathname: string
		search?: string
		hash?: string
	}
	metadata?: RscPayload['metadata']
	clientCss?: RscPayload['clientCss']
	clientJs?: RscPayload['clientJs']
	segments?: RscPayload['segments']
	params?: RscPayload['params']
	config?: BrowserConfig
}) {
	const id = useRef(0)
	const controller = useRef<AbortController | null>(null)
	const [history] = useState(() => new BrowserRouterHistory(url))
	const focusPending = useRef(false)
	const mounted = useRef(false)

	const cacheMode =
		config.router?.cache?.mode ?? (import.meta.env.DEV ? 'off' : 'prerendered')
	const routerCache = useMemo(
		() =>
			new RouterCache({
				mode: cacheMode,
				maxBytes: config.router?.cache?.maxBytes,
				ttl: config.router?.cache?.ttl,
			}),
		[cacheMode, config.router?.cache?.maxBytes, config.router?.cache?.ttl],
	)
	const [segmentPage, setSegmentPage] = useState<RscPayload | null>(null)
	const [layouts, setLayouts] = useState<Map<string, React.ReactNode>>(() => new Map())
	const [segmentMeta, setSegmentMeta] = useState<Map<string, SegmentMeta>>(
		() => new Map(),
	)
	const [layoutCache] = useState(
		() =>
			new LayoutCache({
				enabled: cacheMode === 'all' || cacheMode === 'prerendered',
				maxEntries: config.router?.cache?.maxLayoutEntries,
			}),
	)
	const [routerState] = useState(() => ({ tree: buildRouterTree(segments), params }))

	// keep the request-diff state aligned with action payloads and shell updates
	useEffect(() => {
		routerState.tree = buildRouterTree(segments)
		routerState.params = params
	}, [segments, params, routerState])

	useEffect(() => {
		function clear(paths?: InvalidatedPath[]) {
			if (paths && paths.length > 0) {
				for (const item of paths) {
					routerCache.invalidatePath(item.path, item.scope)
					layoutCache.invalidatePath(item.path, item.scope)
				}

				return
			}

			routerCache.clear()
			layoutCache.clear()
			setSegmentPage(null)
			setLayouts(new Map())
			setSegmentMeta(new Map())
		}

		const channel = createRevalidationChannel(clear)

		function onRevalidate(e: Event) {
			if (!(e instanceof CustomEvent)) return

			const paths = readInvalidatedPaths(e.detail?.paths)

			clear(paths)
			channel.broadcast(paths)
		}

		const hot = import.meta.hot
		const onHot = () => clear()
		hot?.on('rsc:update', onHot)
		window.addEventListener(Events.REVALIDATE, onRevalidate)

		return () => {
			hot?.off?.('rsc:update', onHot)
			channel.close()
			window.removeEventListener(Events.REVALIDATE, onRevalidate)
		}
	}, [layoutCache, routerCache])

	useEffect(() => {
		if (!mounted.current) {
			mounted.current = true
			return
		}

		if (!focusPending.current) return

		focusPending.current = false
		resetFocusAfterNavigation()

		window.dispatchEvent(
			new CustomEvent(Events.NAVIGATION_COMMITTED, {
				detail: { path: url.pathname + (url.search ?? '') + (url.hash ?? '') },
			}),
		)
	}, [url.pathname, url.search, url.hash])

	/**
	 * Navigates to a given path.
	 *
	 * @param to - The target path to navigate to, which can be a route pattern with params or an external URL.
	 * @param opts - Options for navigation, including whether to replace the current history entry and pass query
	 * and route params.
	 * @returns The final path navigated to after any redirects, or the original path if navigation failed.
	 */
	const go: BrowserRouter.Go = useCallback(
		async (to: string | number, opts: BrowserRouter.GoOptions = {}) => {
			// capture before the first await so a mutated options object cannot
			// change how this navigation scrolls
			const scrollIntent = opts.scroll ?? 'top'

			// each navigation invalidates any older request still in flight
			id.current += 1
			const navigationId = id.current

			const currentPath = window.location.pathname + window.location.search
			let path = currentPath

			// support numeric relative navigation like router.go(-1) to go back,
			// or router.go(1) to go forward. Will trigger a popstate event which
			// is intercepted
			if (typeof to === 'number') {
				const entry = history.go(to)
				return `${entry.pathname}${entry.search}`
			}

			const replace = opts.replace ?? DEFAULT_GO_CONFIG.replace

			// stop the previous navigation fetch before starting another
			controller.current?.abort()
			controller.current = null

			try {
				const target = BrowserRouter.toTarget(to, opts.params, opts.query)

				if (BrowserRouter.isExternalTarget(target, window.location.origin)) {
					throw new ExternalUrlError()
				}

				const url = new URL(target, window.location.origin)
				const hash = url.hash

				const key = BrowserRouter.toCacheKey(url.toString(), window.location.origin)
				if (!key) throw new InvalidNavigationUrlError()

				path = key

				if (path !== currentPath) {
					if (replace) {
						history.replaceState(path)
					} else {
						history.pushState(path)
					}
				}

				let payload: RscPayload | undefined
				let resolvedPath = path
				const previousState = { tree: routerState.tree, params: routerState.params }

				setSegmentPage(null)
				setLayouts(new Map())
				setSegmentMeta(new Map())

				/**
				 * Fetch one page/layout patch, cache its nodes and commit the page.
				 */
				async function loadSegmentPatch() {
					const cachedPage = routerCache.getSegment(path)

					if (cachedPage) {
						const cachedPayload = cachedPage.value.payload
						const cachedLayoutIds = (cachedPayload.segments?.layouts ?? []).filter(
							(id): id is string => typeof id === 'string',
						)
						const { values, missing } = layoutCache.getValues(
							cachedLayoutIds,
							cachedPayload.params,
							path,
						)

						setSegmentPage(cachedPayload)

						if (cachedPage.value.meta) setSegmentMeta(cachedPage.value.meta)
						if (values.size > 0) setLayouts(values)
						if (!missing) return
					}

					const ctrl = new AbortController()
					controller.current = ctrl

					const res = await performNavigationFetch(path, {
						headers: {
							[`x-${Config.SLUG}-segment`]: 'patch',
							[`x-${Config.SLUG}-router-state`]: JSON.stringify({
								tree: previousState.tree,
								params: previousState.params,
								cachedLayouts: layoutCache.ids(),
							}),
						},
						signal: ctrl.signal,
					})
					const decoded = decodeRscResponse(res)

					if (!decoded || decoded.segment !== 'patch') {
						throw new InvalidNavigationPayloadError()
					}

					const patch = await decoded.payload

					if (navigationId !== id.current) return

					const targetIds = (patch.segments?.layouts ?? []).filter(
						(id): id is string => typeof id === 'string',
					)
					const collected = collectSegments(patch.root, targetIds, patch.segments?.page)
					const pagePayload = { ...patch, root: collected.page }

					if (collected.meta.size > 0) setSegmentMeta(collected.meta)

					const values = resolveLayoutNodes(
						layoutCache,
						collected.layouts,
						targetIds,
						patch.params,
						patch.cache,
						path,
						routerCache.ttl,
					)
					if (values.size > 0) setLayouts(values)
					setSegmentPage(collected.page ? pagePayload : null)

					const bytes = await decoded.bytes

					if (collected.page) {
						routerCache.setSegment(
							path,
							'dynamic',
							{
								payload: pagePayload,
								url: decoded.url,
								bytes,
								meta: collected.meta,
							},
							{ ttl: pagePayload.cache?.page },
						)
					}
				}

				const cached = routerCache.get(path)

				// ready entries are complete; pending entries can stream their payload
				if (cached) {
					try {
						const stream =
							cached.status === 'ready'
								? {
										payload: Promise.resolve(cached.value.payload),
										url: cached.value.url,
										type: cached.type,
									}
								: await cached.response

						if (stream) {
							const cachedPayload = await stream.payload
							const isShell = stream.type === 'ppr' && cachedPayload.segmentable

							payload = cachedPayload

							if (isShell) {
								setPayload?.(cachedPayload)
								try {
									await loadSegmentPatch()
								} catch {
									// keep the static shell rendered if the page segment fails
									setSegmentPage(null)
								}
							}

							resolvedPath = STATIC
								? path
								: (BrowserRouter.toCacheKey(stream.url, window.location.origin) ?? path)
						}
					} catch {
						// fall back to a normal navigation fetch below
					}
				}

				// no usable cached payload, so make a normal navigation request
				if (!payload) {
					const ctrl = new AbortController()
					controller.current = ctrl

					const promise = performNavigationFetch(path, {
						signal: ctrl.signal,
						headers: { [`x-${Config.SLUG}-segment`]: 'shell' },
					})

					if (navigationId !== id.current) return path

					const res = await promise
					const decoded = decodeRscResponse(res)

					if (!decoded) throw new InvalidNavigationPayloadError()

					// commit as soon as the RSC root is ready; bytes continue in the background
					const loadedPayload = await decoded.payload
					payload = loadedPayload

					const navigationType =
						decoded.type ?? loadedPayload.type ?? (STATIC ? 'full' : 'dynamic')
					const isShell =
						decoded.segment === 'shell' ||
						(navigationType === 'ppr' && loadedPayload.segmentable)

					if (isShell) {
						setPayload?.(loadedPayload)

						try {
							await loadSegmentPatch()
						} catch {
							// keep the static shell rendered if the page segment fails
							setSegmentPage(null)
						}
					}

					resolvedPath = STATIC
						? path
						: decoded.url
							? (BrowserRouter.toCacheKey(decoded.url, window.location.origin) ?? path)
							: path

					// the cache mode decides which of these may be retained:
					// full payloads and PPR shells are build artifacts, while
					// dynamic payloads expire after the configured ttl
					const cacheType =
						navigationType === 'full'
							? 'full'
							: isShell
								? 'ppr'
								: navigationType === 'dynamic'
									? 'dynamic'
									: null

					if (cacheType) {
						void decoded.bytes
							.then(bytes => {
								routerCache.setReady(path, cacheType, {
									payload: loadedPayload,
									url: resolvedPath,
									bytes,
								})
							})
							.catch(() => {})
					}
				}

				// a newer navigation wins, so do not apply stale state
				if (navigationId !== id.current) return resolvedPath

				// redirects and canonicalisation can change the final URL
				if (resolvedPath !== path) {
					history.replaceState(resolvedPath)
				}

				// focus after React commits the new payload
				focusPending.current = scrollIntent !== 'none' && !hash

				setPayload?.(payload)
				routerState.tree = buildRouterTree(payload?.segments)
				routerState.params = payload?.params
				applyScroll(scrollIntent, hash)

				// notify listeners only after the payload has been applied
				window.dispatchEvent(
					new CustomEvent(Events.NAVIGATION, {
						detail: { path: resolvedPath },
					}),
				)

				return resolvedPath
			} catch (err) {
				// aborts are expected when a newer navigation starts
				if (err instanceof Error && err.name === 'AbortError') {
					return path
				}

				window.dispatchEvent(
					new CustomEvent(Events.NAVIGATION_ERROR, {
						detail: {
							path,
							error: err instanceof Error ? err.message : Logger.print(err),
							code:
								isBrowserRouterError(err) || isRouteTargetError(err)
									? err.code
									: undefined,
							hint:
								err instanceof Error && 'hint' in err && typeof err.hint === 'string'
									? err.hint
									: undefined,
						},
					}),
				)

				logger.error('Navigation failed', err)
			} finally {
				// only clear the controller if this navigation is still current
				if (navigationId === id.current) controller.current = null
			}

			return path
		},
		[history, layoutCache, routerCache, routerState, setPayload],
	)

	/**
	 * Fetch a page/layout patch in the background and warm the segment caches.
	 */
	const prefetchSegmentPatch = useCallback(
		async (key: string) => {
			if (!routerCache.segmentsEnabled) return
			if (routerCache.getSegment(key)) return

			const res = await performNavigationFetch(key, {
				headers: {
					[`x-${Config.SLUG}-segment`]: 'patch',
					[`x-${Config.SLUG}-prefetch`]: '1',
					[`x-${Config.SLUG}-router-state`]: JSON.stringify({
						tree: routerState.tree,
						params: routerState.params,
						cachedLayouts: layoutCache.ids(),
					}),
				},
			})
			const decoded = decodeRscResponse(res)

			if (!decoded || decoded.segment !== 'patch') return

			const patch = await decoded.payload
			const targetIds = (patch.segments?.layouts ?? []).filter(
				(id): id is string => typeof id === 'string',
			)
			const collected = collectSegments(patch.root, targetIds, patch.segments?.page)

			resolveLayoutNodes(
				layoutCache,
				collected.layouts,
				targetIds,
				patch.params,
				patch.cache,
				key,
				routerCache.ttl,
			)

			if (!collected.page) return

			const pagePayload = { ...patch, root: collected.page }

			routerCache.setSegment(
				key,
				'dynamic',
				{
					payload: pagePayload,
					url: decoded.url,
					// the patch root is enough to reuse the page; byte accounting
					// is intentionally deferred until the stream completes
					bytes: 0,
					meta: collected.meta,
				},
				{ ttl: pagePayload.cache?.page },
			)
		},
		[layoutCache, routerCache, routerState],
	)

	/**
	 * Prefetches the RSC response for a given path and caches it for later navigation.
	 * Does nothing if a cached response already exists for the path.
	 *
	 * @param path - The target path to prefetch.
	 * @returns Void.
	 */
	const prefetch = useCallback(
		(path: string) => {
			if (!routerCache.enabled) return

			const key = BrowserRouter.toCacheKey(path, window.location.origin)
			if (!key) return

			// avoid duplicate requests for cached or in-flight entries
			if (routerCache.has(key)) return

			// prefetches use the normal decode path but are never committed by this call
			const response = performNavigationFetch(key, {
				headers: { [`x-${Config.SLUG}-prefetch`]: '1' },
			})
				.then(decodeRscResponse)
				.then(decoded => {
					if (decoded?.segment === 'shell' && routerCache.segmentsEnabled) {
						// start the patch alongside shell decoding instead of waiting for it
						void prefetchSegmentPatch(key).catch(() => {})
					}

					return decoded
				})

			routerCache.set(key, response)
		},
		[prefetchSegmentPatch, routerCache],
	)

	/**
	 * Refreshes the current page by re-fetching the RSC response for the current path and updating the
	 * payload. It also clears any cached response for the current path to ensure that the latest
	 * version is fetched.
	 */
	const evict = useCallback(
		(path: string) => {
			const key = BrowserRouter.toCacheKey(path, window.location.origin)
			if (key) {
				routerCache.remove(key)
				routerCache.removeSegment(key)
			}
			layoutCache.clear()
		},
		[layoutCache, routerCache],
	)

	const refresh = useCallback(() => {
		const currentPath = window.location.pathname + window.location.search
		const key = BrowserRouter.toCacheKey(currentPath, window.location.origin)

		if (!key) return Promise.resolve(currentPath)

		routerCache.remove(key)
		routerCache.removeSegment(key)
		layoutCache.clear()
		setSegmentPage(null)

		// a refresh stays exactly where the user is
		return go(currentPath, { replace: true, scroll: 'none' })
	}, [go, layoutCache, routerCache])

	useEffect(() => {
		const h = history

		function handler() {
			const entry = h.onPopState()

			// back/forward restores the position the entry was left at
			void go(BrowserRouter.toTarget(window.location.pathname + window.location.search), {
				replace: true,
				scroll: { restore: entry?.scrollY ?? 0 },
			})
		}

		window.addEventListener('popstate', handler)

		return () => {
			controller.current?.abort()
			controller.current = null

			window.removeEventListener('popstate', handler)
		}
	}, [go, history])

	// take over scroll restoration so back/forward can restore saved positions
	useEffect(() => {
		// remember the browser's own setting so an unmount can hand it back
		const previous =
			'scrollRestoration' in window.history ? window.history.scrollRestoration : undefined

		if (previous !== undefined) {
			window.history.scrollRestoration = 'manual'
		}

		let pending = false

		function onScroll() {
			if (pending) return

			pending = true

			requestAnimationFrame(() => {
				pending = false
				history.saveScroll()
			})
		}

		window.addEventListener('scroll', onScroll, { passive: true })

		return () => {
			window.removeEventListener('scroll', onScroll)

			if (previous !== undefined) {
				window.history.scrollRestoration = previous
			}
		}
	}, [history])

	const pageId = segmentPage?.segments?.page ?? null
	const pageHead = pageId ? segmentMeta.get(pageId)?.head : undefined
	const segmentValue = useMemo(
		() => ({ page: segmentPage, layouts, meta: segmentMeta }),
		[segmentPage, layouts, segmentMeta],
	)
	const historyEntries = history.snapshot()
	const historyIndex = history.index
	const historyState = useMemo(
		() => ({ entries: historyEntries, index: historyIndex }),
		[historyEntries, historyIndex],
	)
	const actions = useMemo(() => ({ go, prefetch }), [go, prefetch])
	const value = useMemo(
		() => ({
			go,
			evict,
			prefetch,
			refresh,
			isNavigating,
			url: {
				pathname: url.pathname,
				search: url.search,
				hash: url.hash,
			},
			history: historyState,
		}),
		[go, historyState, evict, prefetch, refresh, isNavigating, url],
	)

	return (
		<PrefetchObserverProvider>
			<SegmentContext value={segmentValue}>
				<Suspense fallback={null}>
					<Head
						metadata={pageHead ?? segmentPage?.metadata ?? metadata}
						url={segmentPage?.url ?? url}
						clientCss={segmentPage?.clientCss ?? clientCss}
						clientJs={segmentPage?.clientJs ?? clientJs}
					/>
				</Suspense>
				<BrowserRouterActionsContext value={actions}>
					<BrowserRouterContext value={value}>{children}</BrowserRouterContext>
				</BrowserRouterActionsContext>
			</SegmentContext>
		</PrefetchObserverProvider>
	)
}
