'use client'
import { createContext, useCallback, useEffect, useMemo, useRef } from 'react'

import { createFromFetch, createFromReadableStream } from '@vitejs/plugin-rsc/browser'

import { getDocumentNonce } from '../../utils/get-document-nonce.js'
import { Logger } from '../../utils/logger.js'

import type { RscPayload } from '../env/rsc.js'
import * as Config from '../../config.js'
import * as Events from '../../events.js'
import { BrowserRouterHistory } from './history.js'
import { PrefetchCache } from './prefetch-cache.js'
import { PrefetchObserverProvider } from './prefetch-observer.js'
import * as BrowserRouter from './shared.js'

export * as BrowserRouter from './shared.js'

export const BrowserRouterContext = createContext<BrowserRouter.Context>({
	go: async () => '',
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
const prefetchCache = new PrefetchCache()

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
 *
 * @description Consuming the body here lets the network request finish even when
 * the user never navigates to the prefetched route.
 */
async function decodePrefetchedResponse(response: Response) {
	if (response.status === 204 || !response.ok) return null

	const text = await response.text()
	const payload = await createFromReadableStream<RscPayload>(
		new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new TextEncoder().encode(text))
				controller.close()
			},
		}),
	)

	return { payload, url: response.url }
}

function performNavigationFetch(path: string, init?: RequestInit) {
	if (STATIC) return fetch(getPayloadUrl(path), init)

	const headers = new Headers(init?.headers)
	headers.set('accept', 'text/x-component')

	const nonce = getDocumentNonce()
	if (nonce) headers.set('x-solas-nonce', nonce)

	return fetch(path, { ...init, headers })
}

const MAX_HASH_ATTEMPTS = 20

function nextFrame(callback: () => void) {
	if (typeof requestAnimationFrame === 'function') {
		requestAnimationFrame(callback)
		return
	}

	setTimeout(callback, 0)
}

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

	nextFrame(() => scrollToHash(hash, attempts - 1))
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
		nextFrame(() => nextFrame(() => window.scrollTo(0, intent.restore)))
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
}: {
	children: React.ReactNode
	setPayload?: (payload: RscPayload) => void
	isNavigating?: boolean
	url: {
		pathname: string
		search?: string
		hash?: string
	}
}) {
	const id = useRef(0)
	const controller = useRef<AbortController | null>(null)
	const history = useRef(new BrowserRouterHistory(url))
	const focusPending = useRef(false)
	const mounted = useRef(false)

	useEffect(() => {
		if (!mounted.current) {
			mounted.current = true
			return
		}

		if (!focusPending.current) return

		focusPending.current = false
		resetFocusAfterNavigation()

		window.dispatchEvent(
			new CustomEvent(Events.names.NAVIGATION_COMMITTED, {
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

			controller.current?.abort()
			controller.current = null

			try {
				const target = BrowserRouter.toTarget(to, opts.params, opts.query)

				if (BrowserRouter.isExternalTarget(target, window.location.origin)) {
					throw new Error('[router.go]: external URLs are not supported. Use <a> instead')
				}

				const url = new URL(target, window.location.origin)
				const hash = url.hash

				const key = BrowserRouter.toCacheKey(url.toString(), window.location.origin)
				if (!key) throw new Error('Invalid navigation url')

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

				const prefetched = prefetchCache.get(path)

				if (prefetched) {
					prefetchCache.remove(path)

					try {
						const result = await prefetched

						if (result) {
							payload = result.payload
							resolvedPath = STATIC
								? path
								: (BrowserRouter.toCacheKey(result.url, window.location.origin) ?? path)
						}
					} catch {
						// fall back to a normal navigation fetch below
					}
				}

				if (!payload) {
					const ctrl = new AbortController()
					controller.current = ctrl

					const promise = performNavigationFetch(path, { signal: ctrl.signal })

					if (navigationId !== id.current) return path

					const [res, loadedPayload] = await Promise.all([
						promise,
						createFromFetch<RscPayload>(promise),
					])

					// on a static host the payload comes from `<path>.rsc.txt`, so the
					// response URL is not the page path
					payload = loadedPayload
					resolvedPath = STATIC
						? path
						: (BrowserRouter.toCacheKey(res.url, window.location.origin) ?? path)
				}

				if (navigationId !== id.current) return resolvedPath

				if (resolvedPath !== path) {
					history.current.replaceState(resolvedPath)
				}

				focusPending.current = scrollIntent !== 'none' && !hash

				setPayload?.(payload)
				applyScroll(scrollIntent, hash)

				window.dispatchEvent(
					new CustomEvent(Events.names.NAVIGATION, {
						detail: { path: resolvedPath },
					}),
				)

				return resolvedPath
			} catch (err) {
				if (err instanceof Error && err.name === 'AbortError') {
					return path
				}

				window.dispatchEvent(
					new CustomEvent(Events.names.NAVIGATION_ERROR, {
						detail: {
							path,
							error: err instanceof Error ? err.message : Logger.print(err),
						},
					}),
				)

				logger.error('[navigation] failed', err)
			} finally {
				if (navigationId === id.current) controller.current = null
			}

			return path
		},
		[setPayload],
	)

	/**
	 * Prefetches the RSC response for a given path and caches it for later navigation.
	 * Does nothing if a cached response already exists for the path.
	 *
	 * @param path - The target path to prefetch.
	 * @returns Void.
	 */
	const prefetch = useCallback((path: string) => {
		const key = BrowserRouter.toCacheKey(path, window.location.origin)
		if (!key) return

		if (prefetchCache.has(key)) return

		const response = performNavigationFetch(key, {
			headers: { [`x-${Config.SLUG}-prefetch`]: '1' },
		}).then(decodePrefetchedResponse)

		prefetchCache.set(key, response)
		void response.catch(() => prefetchCache.remove(key))
	}, [])

	/**
	 * Refreshes the current page by re-fetching the RSC response for the current path and updating the
	 * payload. It also clears any cached response for the current path to ensure that the latest
	 * version is fetched.
	 */
	const refresh = useCallback(() => {
		const currentPath = window.location.pathname + window.location.search
		const key = BrowserRouter.toCacheKey(currentPath, window.location.origin)

		if (!key) return Promise.resolve(currentPath)

		// a refresh stays exactly where the user is
		return go(currentPath, { replace: true, scroll: 'none' })
	}, [go])

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

			nextFrame(() => {
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

	const value = useMemo(
		() => ({
			go,
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
		[go, prefetch, refresh, isNavigating, url],
	)

	return (
		<PrefetchObserverProvider>
			<BrowserRouterContext value={value}>{children}</BrowserRouterContext>
		</PrefetchObserverProvider>
	)
}
