'use client'
import { createContext, useCallback, useEffect, useMemo, useRef } from 'react'

import { createFromFetch } from '@vitejs/plugin-rsc/browser'

import { Logger } from '../../utils/logger.js'

import type { RscPayload } from '../env/rsc.js'
import * as Events from '../../events.js'
import { BrowserRouterHistory } from './history.js'
import { ResponseCache } from './response-cache.js'
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
const responseCache = new ResponseCache()

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

function performNavigationFetch(path: string, init?: RequestInit) {
	return STATIC
		? fetch(getPayloadUrl(path), init)
		: fetch(path, { ...init, headers: { ...init?.headers, accept: 'text/x-component' } })
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

			let existing = false

			try {
				const target = BrowserRouter.toTarget(to, opts.params, opts.query)

				if (BrowserRouter.isExternalTarget(target, window.location.origin)) {
					throw new Error('[router.go]: external URLs are not supported. Use <a> instead')
				}

				const url = new URL(target, window.location.origin)
				const hash = url.hash
				const key = ResponseCache.toCacheKey(url.toString(), window.location.origin)
				if (!key) throw new Error('Invalid navigation url')

				path = key

				if (path !== currentPath) {
					if (replace) {
						history.current.replaceState(path)
					} else {
						history.current.pushState(path)
					}
				}

				let promise = responseCache.get(path)
				existing = promise !== undefined

				if (!promise) {
					const ctrl = new AbortController()
					controller.current = ctrl

					promise = performNavigationFetch(path, { signal: ctrl.signal })
					responseCache.set(path, promise)
				}

				if (navigationId !== id.current) return path

				const [res, payload] = await Promise.all([
					promise,
					createFromFetch<RscPayload>(promise),
				])

				// on a static host the payload comes from `<path>.rsc.txt`, so the
				// response URL is not the page path
				const resolvedPath = STATIC
					? path
					: (ResponseCache.toCacheKey(res.url, window.location.origin) ?? path)

				if (navigationId !== id.current) return resolvedPath

				if (resolvedPath !== path) {
					history.current.replaceState(resolvedPath)
				}

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
				if (!existing) responseCache.remove(path)
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
		const key = ResponseCache.toCacheKey(path, window.location.origin)
		if (!key) return

		if (responseCache.has(key)) return
		responseCache.set(key, performNavigationFetch(key))
	}, [])

	/**
	 * Refreshes the current page by re-fetching the RSC response for the current path and updating the
	 * payload. It also clears any cached response for the current path to ensure that the latest
	 * version is fetched.
	 */
	const refresh = useCallback(() => {
		const currentPath = window.location.pathname + window.location.search
		const key = ResponseCache.toCacheKey(currentPath, window.location.origin)

		if (!key) return Promise.resolve(currentPath)
		if (responseCache.has(key)) responseCache.remove(key)

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

	return <BrowserRouterContext value={value}>{children}</BrowserRouterContext>
}
