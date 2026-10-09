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

					promise = fetch(path, {
						headers: { accept: 'text/x-component' },
						signal: ctrl.signal,
					})

					responseCache.set(path, promise)
				}

				if (navigationId !== id.current) return path

				const [res, payload] = await Promise.all([
					promise,
					createFromFetch<RscPayload>(promise),
				])
				const resolvedPath =
					ResponseCache.toCacheKey(res.url, window.location.origin) ?? path

				if (navigationId !== id.current) return resolvedPath

				if (resolvedPath !== path) {
					history.current.replaceState(resolvedPath)
				}

				setPayload?.(payload)

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
		responseCache.set(key, fetch(key, { headers: { Accept: 'text/x-component' } }))
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

		return go(currentPath, {
			replace: true,
		})
	}, [go])

	useEffect(() => {
		const h = history.current

		function handler() {
			h.onPopState()

			void go(BrowserRouter.toTarget(window.location.pathname + window.location.search), {
				replace: true,
			})
		}

		window.addEventListener('popstate', handler)

		return () => {
			controller.current?.abort()
			controller.current = null

			window.removeEventListener('popstate', handler)
		}
	}, [go])

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
