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
import { Logger } from '../../utils/logger.js'

import type { BrowserConfig } from '../../types.js'
import type { RscPayload } from '../env/rsc.js'
import * as Config from '../../config.js'
import * as Events from '../../events.js'
import { Head } from '../render/head.js'
import { describeSegments } from '../route-segments.js'
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
import { isRouterCacheEntryType, RouterCache } from './router-cache.js'
import { collectSegments, SegmentContext, type SegmentMeta } from './segment-slot.js'
import * as BrowserRouter from './shared.js'

export * as BrowserRouter from './shared.js'

export const BrowserRouterContext = createContext<BrowserRouter.Context>({
	go: async () => '',
	invalidate: () => {},
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

const DEFAULT_GO_CONFIG = {
	replace: false,
} satisfies BrowserRouter.GoOptions

const logger = new Logger()

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
 * Read and decode a prefetched RSC response.
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
		segmentHeader === 'page' || segmentHeader === 'shell' || segmentHeader === 'patch'
			? segmentHeader
			: null

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
 * Apply the scroll position for a completed navigation. Push navigations go to
 * the top (or the target hash), back/forward restore the saved position, and
 * refreshes leave the page where it is.
 */
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

export function BrowserRouterProvider({
	children,
	setPayload,
	isNavigating = false,
	url,
	metadata,
	clientCss,
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
	config?: BrowserConfig
}) {
	const id = useRef(0)
	const controller = useRef<AbortController | null>(null)
	const history = useRef(new BrowserRouterHistory(url))
	const focusPending = useRef(false)
	const mounted = useRef(false)

	const routerCache = useMemo(
		() =>
			new RouterCache({
				enabled: config.router?.cache?.enabled ?? !import.meta.env.DEV,
				maxBytes: config.router?.cache?.maxBytes,
				ttl: config.router?.cache?.ttl,
			}),
		[config],
	)
	const [segmentPage, setSegmentPage] = useState<RscPayload | null>(null)
	const [layouts, setLayouts] = useState<Map<string, React.ReactNode>>(() => new Map())
	const [segmentMeta, setSegmentMeta] = useState<Map<string, SegmentMeta>>(
		() => new Map(),
	)
	const layoutCache = useRef(new LayoutCache())

	useEffect(() => {
		const clear = (event?: Event) => {
			const detail = (
				event as
					| CustomEvent<{
							paths?: { path: string; scope: 'page' | 'layout' }[]
					  }>
					| undefined
			)?.detail
			const paths = detail?.paths
			let handled = false

			if (paths && paths.length > 0) {
				for (const item of paths) {
					routerCache.invalidatePath(item.path, item.scope)

					layoutCache.current.invalidatePath(item.path, item.scope)
				}

				handled = true
			}

			if (handled) return

			routerCache.clear()
			layoutCache.current.clear()
			setSegmentPage(null)
			setLayouts(new Map())
			setSegmentMeta(new Map())
		}

		const hot = import.meta.hot
		const onHot = () => clear()
		hot?.on('rsc:update', onHot)
		window.addEventListener(Events.REVALIDATE, clear)

		return () => {
			hot?.off?.('rsc:update', onHot)
			window.removeEventListener(Events.REVALIDATE, clear)
		}
	}, [routerCache])

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
				const entry = history.current.go(to)
				return `${entry.pathname}${entry.search}`
			}

			const replace = opts?.replace ?? DEFAULT_GO_CONFIG.replace

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
						history.current.replaceState(path)
					} else {
						history.current.pushState(path)
					}
				}

				let payload: RscPayload | undefined
				let resolvedPath = path

				setSegmentPage(null)
				setLayouts(new Map())
				setSegmentMeta(new Map())

				/**
				 * Read cached layout nodes for a target chain and report whether
				 * any are missing.
				 */
				function getCachedLayouts(
					layoutIds: (string | null)[] | undefined,
					params: Record<string, string | string[]> | undefined,
				) {
					const targetIds = (layoutIds ?? []).filter(
						(id): id is string => typeof id === 'string',
					)

					return layoutCache.current.getValues(targetIds, params)
				}

				/**
				 * List cached layout IDs so the server can diff the target tree.
				 */
				function getCachedLayoutIds() {
					return layoutCache.current.ids()
				}

				/**
				 * Store layout nodes from a patch and expose them to the slots.
				 */
				function applyLayoutSegments(
					layouts: Map<string, React.ReactNode>,
					targetIds: string[],
					params?: Record<string, string | string[]>,
					cache?: RscPayload['cache'],
				) {
					const now = Date.now()
					const expiresAt =
						cache?.layouts === null
							? Number.POSITIVE_INFINITY
							: now + (cache?.layouts ?? routerCache.ttl)
					const values = new Map<string, React.ReactNode>()
					const dynamic = new Set(cache?.dynamicLayouts ?? [])
					let dynamicChain = false

					for (const id of targetIds) {
						if (dynamic.has(id)) dynamicChain = true

						const cached = dynamicChain ? undefined : layoutCache.current.get(id, params)

						if (cached) {
							values.set(id, cached.value)
							continue
						}

						const value = layouts.get(id)

						if (value === undefined) continue

						values.set(id, value)

						// Dynamic layouts and their descendants are request data,
						// not static shell nodes.
						if (!dynamicChain) {
							layoutCache.current.set(id, params, value, { expiresAt, path })
						}
					}

					if (values.size > 0) setLayouts(values)
				}

				/**
				 * Fetch one page/layout patch, cache its nodes and commit the page.
				 */
				async function loadSegmentPatch() {
					const cachedPage = routerCache.getSegment(path)

					if (cachedPage) {
						const cachedPayload = cachedPage.value.payload
						const { values, missing } = getCachedLayouts(
							cachedPayload.segments?.layouts,
							cachedPayload.params,
						)

						setSegmentPage(cachedPayload)

						if (cachedPage.value.meta) setSegmentMeta(cachedPage.value.meta)

						if (!missing) {
							if (values.size > 0) setLayouts(values)
							return
						}

						if (values.size > 0) setLayouts(values)
					}

					const ctrl = new AbortController()
					controller.current = ctrl

					const res = await performNavigationFetch(path, {
						headers: {
							[`x-${Config.SLUG}-segment`]: 'patch',
							[`x-${Config.SLUG}-router-state`]: JSON.stringify({
								segments: payload?.segments ? describeSegments(payload.segments) : [],
								params: payload?.params,
								cachedLayouts: getCachedLayoutIds(),
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
					applyLayoutSegments(collected.layouts, targetIds, patch.params, patch.cache)
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
						if (cached.status === 'ready') {
							const cachedPayload = cached.value.payload
							const isShell = cached.type === 'ppr' && cachedPayload.segmentable

							if (isShell) {
								payload = cachedPayload
								setPayload?.(cachedPayload)
								try {
									await loadSegmentPatch()
								} catch {
									// keep the static shell rendered if the page segment fails
									setSegmentPage(null)
								}
							} else {
								payload = cachedPayload
							}

							resolvedPath = STATIC
								? path
								: (BrowserRouter.toCacheKey(cached.value.url, window.location.origin) ??
									path)
						} else if (cached.status === 'pending') {
							const stream = await cached.response

							if (stream) {
								const cachedPayload = await stream.payload
								const isShell = stream.type === 'ppr' && cachedPayload.segmentable

								if (isShell) {
									payload = cachedPayload
									setPayload?.(cachedPayload)
									try {
										await loadSegmentPatch()
									} catch {
										// keep the static shell rendered if the page segment fails
										setSegmentPage(null)
									}
								} else {
									payload = cachedPayload
								}

								resolvedPath = STATIC
									? path
									: (BrowserRouter.toCacheKey(stream.url, window.location.origin) ?? path)
							}
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

					// only full prerendered payloads are cached indefinitely
					if (navigationType === 'full') {
						void decoded.bytes
							.then(bytes => {
								routerCache.setReady(path, 'full', {
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
					history.current.replaceState(resolvedPath)
				}

				// focus after React commits the new payload
				focusPending.current = scrollIntent !== 'none' && !hash

				setPayload?.(payload)
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
						},
					}),
				)

				logger.error('[navigation] failed', err)
			} finally {
				// only clear the controller if this navigation is still current
				if (navigationId === id.current) controller.current = null
			}

			return path
		},
		[routerCache, setPayload],
	)

	/**
	 * Fetch a page/layout patch in the background and warm the segment caches.
	 */
	const prefetchSegmentPatch = useCallback(
		async (key: string, shell: RscPayload) => {
			if (routerCache.getSegment(key)) return

			const cachedLayouts = layoutCache.current.ids()

			const res = await performNavigationFetch(key, {
				headers: {
					[`x-${Config.SLUG}-segment`]: 'patch',
					[`x-${Config.SLUG}-prefetch`]: '1',
					[`x-${Config.SLUG}-router-state`]: JSON.stringify({
						segments: shell.segments ? describeSegments(shell.segments) : [],
						params: shell.params,
						cachedLayouts: [...cachedLayouts],
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
			const now = Date.now()
			const expiresAt =
				patch.cache?.layouts === null
					? Number.POSITIVE_INFINITY
					: now + (patch.cache?.layouts ?? routerCache.ttl)

			const dynamic = new Set(patch.cache?.dynamicLayouts ?? [])
			let dynamicChain = false

			for (const id of targetIds) {
				if (dynamic.has(id)) dynamicChain = true
				if (dynamicChain) continue

				if (layoutCache.current.get(id, patch.params)) continue

				const value = collected.layouts.get(id)
				if (value === undefined) continue

				layoutCache.current.set(id, patch.params, value, {
					expiresAt,
					path: key,
				})
			}

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
		[routerCache],
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
					if (decoded?.segment === 'shell') {
						void decoded.payload
							.then(payload => {
								if (payload.segmentable) {
									return prefetchSegmentPatch(key, payload)
								}
							})
							.catch(() => {})
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
	const invalidate = useCallback(
		(path: string) => {
			const key = BrowserRouter.toCacheKey(path, window.location.origin)
			if (key) {
				routerCache.remove(key)
				routerCache.removeSegment(key)
			}
			layoutCache.current.clear()
		},
		[routerCache],
	)

	const refresh = useCallback(() => {
		const currentPath = window.location.pathname + window.location.search
		const key = BrowserRouter.toCacheKey(currentPath, window.location.origin)

		if (!key) return Promise.resolve(currentPath)

		routerCache.remove(key)
		routerCache.removeSegment(key)
		layoutCache.current.clear()
		setSegmentPage(null)

		// a refresh stays exactly where the user is
		return go(currentPath, { replace: true, scroll: 'none' })
	}, [go, routerCache])

	useEffect(() => {
		const h = history.current

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
	}, [go])

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
				history.current.saveScroll()
			})
		}

		window.addEventListener('scroll', onScroll, { passive: true })

		return () => {
			window.removeEventListener('scroll', onScroll)

			if (previous !== undefined) {
				window.history.scrollRestoration = previous
			}
		}
	}, [])

	const pageId = segmentPage?.segments?.page ?? null
	const pageHead = pageId ? segmentMeta.get(pageId)?.head : undefined
	const value = useMemo(
		() => ({
			go,
			invalidate,
			prefetch,
			refresh,
			isNavigating,
			url: {
				pathname: url.pathname,
				search: url?.search,
				hash: url?.hash,
			},
			history: {
				entries: history.current.entries,
				index: history.current.index,
			},
		}),
		[go, invalidate, prefetch, refresh, isNavigating, url],
	)

	return (
		<PrefetchObserverProvider>
			<SegmentContext value={{ page: segmentPage, layouts, meta: segmentMeta }}>
				<Suspense fallback={null}>
					<Head
						metadata={pageHead ?? segmentPage?.metadata ?? metadata}
						url={segmentPage?.url ?? url}
						clientCss={segmentPage?.clientCss ?? clientCss}
					/>
				</Suspense>
				<BrowserRouterContext value={value}>{children}</BrowserRouterContext>
			</SegmentContext>
		</PrefetchObserverProvider>
	)
}
