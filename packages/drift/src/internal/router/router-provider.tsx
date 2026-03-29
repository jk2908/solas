'use client'

import { useCallback, useEffect, useMemo, useRef } from 'react'

import { createFromFetch } from '@vitejs/plugin-rsc/browser'

import { Drift } from '../../drift'

import { Logger } from '../../utils/logger'

import type { RSCPayload } from '../env/rsc'
import { Prefetcher } from './prefetcher'
import { type Navigation, RouterContext } from './router-context'

const DEFAULT_GO_CONFIG = {
	replace: false,
} satisfies Navigation.GoOptions

const logger = new Logger()
const prefetcher = new Prefetcher()

export function RouterProvider({
	children,
	setPayload,
	isNavigating = false,
}: {
	children: React.ReactNode
	setPayload?: (payload: RSCPayload) => void
	isNavigating?: boolean
}) {
	// id to track active navigations
	const id = useRef(0)
	// abort controller for in-flight navigation
	const controller = useRef<AbortController | null>(null)

	/**
	 * Navigate to a new route
	 * @param to the destination url (absolute or relative to origin)
	 * @param opts navigation options
	 * @returns the path that was navigated to (relative to origin)
	 */
	const go = useCallback(
		async (to: string, opts: Navigation.GoOptions = {}) => {
			id.current += 1
			const navigationId = id.current

			controller.current?.abort()
			controller.current = null

			const url = new URL(to, window.location.origin)
			const replace = opts?.replace ?? DEFAULT_GO_CONFIG.replace

			if (opts?.query) {
				for (const [key, value] of Object.entries(opts.query)) {
					url.searchParams.set(key, String(value))
				}
			}

			const path = Prefetcher.key(url.toString(), window.location.origin)

			// distinguish an actual prior prefetch from a cache entry we create
			// opportunistically for this navigation
			const existing = prefetcher.has(path)

			try {
				let promise = prefetcher.get(path)

				if (!promise) {
					const ctrl = new AbortController()
					controller.current = ctrl

					promise = fetch(path, {
						headers: { accept: 'text/x-component' },
						signal: ctrl.signal,
					})
				}

				if (!prefetcher.has(path)) prefetcher.set(path, promise)

				// if another navigation has started since this one, ignore the result
				// and return early
				if (navigationId !== id.current) return path

				const res = await createFromFetch<RSCPayload>(promise)

				// check again if another navigation has started while we were awaiting
				// the response
				if (navigationId !== id.current) return path

				// this state update is already wrapped in a
				// transition before being passed as props
				setPayload?.(res)

				if (replace) {
					window.history.replaceState(null, '', path)
				} else {
					window.history.pushState(null, '', path)
				}

				window.dispatchEvent(
					new CustomEvent(Drift.Events.names.NAVIGATION, { detail: { path } }),
				)
			} catch (err) {
				if (err instanceof Error && err.name === 'AbortError') {
					return path
				}

				window.dispatchEvent(
					new CustomEvent(Drift.Events.names.NAVIGATION_ERROR, {
						detail: {
							path,
							error: err instanceof Error ? err.message : Logger.print(err),
						},
					}),
				)

				logger.error('[navigation] failed', err)
			} finally {
				if (navigationId === id.current) controller.current = null

				// preserve entries that were already prefetched so nearby follow-up
				// navigations can still reuse them within the prefetch TTL window
				if (!existing) {
					// entries created by go() only serve as in-flight dedupe for this
					// navigation (i.e. not intentionally prefetched)
					prefetcher.remove(path)
				}
			}

			return path
		},
		[setPayload],
	)

	/**
	 * Prefetch a route's assets by fetching the RSC payload
	 * @param path the route path to prefetch (absolute or relative to origin)
	 * @returns void
	 */
	const prefetch = useCallback((path: string) => {
		const connection = window.navigator.connection

		if (document.visibilityState === 'hidden') return
		if (connection?.saveData) return
		if (['2g', 'slow-2g'].includes(connection?.effectiveType ?? '')) return

		const key = Prefetcher.key(path, window.location.origin)

		if (prefetcher.has(key)) return
		prefetcher.set(key, fetch(key, { headers: { Accept: 'text/x-component' } }))
	}, [])

	useEffect(() => {
		const handler = () => go(window.location.href, { replace: true })
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
		}),
		[go, prefetch, isNavigating],
	)

	return <RouterContext value={value}>{children}</RouterContext>
}
