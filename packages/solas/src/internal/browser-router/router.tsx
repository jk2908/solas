'use client'
import { createContext, useCallback, useEffect, useMemo, useRef } from 'react'

import { createFromFetch } from '@vitejs/plugin-rsc/browser'

import { Logger } from '../../utils/logger.js'

import type { RscPayload } from '../env/rsc.js'
import { Solas } from '../../solas.js'
import { Prefetcher } from '../prefetcher.js'
import { BrowserRouter } from './shared.js'

export { BrowserRouter } from './shared.js'

export const BrowserRouterContext = createContext<{
	go: BrowserRouter.Go
	prefetch: (path: string) => void
	isNavigating: boolean
	url: {
		pathname?: string
		search?: string
	}
}>({
	go: async () => '',
	prefetch: () => {},
	isNavigating: false,
	url: {},
})

const DEFAULT_GO_CONFIG = {
	replace: false,
} satisfies BrowserRouter.GoOptions

const logger = new Logger()
const prefetcher = new Prefetcher()

export function BrowserRouterProvider({
	children,
	setPayload,
	isNavigating = false,
	url,
}: {
	children: React.ReactNode
	setPayload?: (payload: RscPayload) => void
	isNavigating?: boolean
	url?: {
		pathname?: string
		search?: string
	}
}) {
	const id = useRef(0)
	const controller = useRef<AbortController | null>(null)

	const go: BrowserRouter.Go = useCallback(
		async (to: string, opts: BrowserRouter.GoOptions = {}) => {
			id.current += 1
			const navigationId = id.current

			const currentPath = window.location.pathname + window.location.search
			let path = currentPath
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
				const key = Prefetcher.key(url.toString(), window.location.origin)
				if (!key) throw new Error('Invalid navigation url')

				path = key

				if (path !== currentPath) {
					if (replace) {
						window.history.replaceState(null, '', path)
					} else {
						window.history.pushState(null, '', path)
					}
				}

				let promise = prefetcher.get(path)
				existing = promise !== undefined

				if (!promise) {
					const ctrl = new AbortController()
					controller.current = ctrl

					promise = fetch(path, {
						headers: { accept: 'text/x-component' },
						signal: ctrl.signal,
					})

					prefetcher.set(path, promise)
				}

				if (navigationId !== id.current) return path

				const [res, payload] = await Promise.all([
					promise,
					createFromFetch<RscPayload>(promise),
				])
				const resolvedPath = Prefetcher.key(res.url, window.location.origin) ?? path

				if (navigationId !== id.current) return resolvedPath

				if (resolvedPath !== path) {
					window.history.replaceState(null, '', resolvedPath)
				}

				setPayload?.(payload)

				window.dispatchEvent(
					new CustomEvent(Solas.Events.names.NAVIGATION, {
						detail: { path: resolvedPath },
					}),
				)

				return resolvedPath
			} catch (err) {
				if (err instanceof Error && err.name === 'AbortError') {
					return path
				}

				window.dispatchEvent(
					new CustomEvent(Solas.Events.names.NAVIGATION_ERROR, {
						detail: {
							path,
							error: err instanceof Error ? err.message : Logger.print(err),
						},
					}),
				)

				logger.error('[navigation] failed', err)
			} finally {
				if (navigationId === id.current) controller.current = null

				if (!existing) {
					prefetcher.remove(path)
				}
			}

			return path
		},
		[setPayload],
	)

	const prefetch = useCallback((path: string) => {
		const key = Prefetcher.key(path, window.location.origin)
		if (!key) return

		if (prefetcher.has(key)) return
		prefetcher.set(key, fetch(key, { headers: { Accept: 'text/x-component' } }))
	}, [])

	useEffect(() => {
		const handler = () =>
			go(BrowserRouter.toTarget(window.location.pathname + window.location.search), {
				replace: true,
			})

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
			isNavigating,
			url: {
				pathname: url?.pathname,
				search: url?.search,
			},
		}),
		[go, prefetch, isNavigating, url],
	)

	return <BrowserRouterContext value={value}>{children}</BrowserRouterContext>
}
