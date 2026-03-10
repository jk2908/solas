'use client'

import { useCallback, useEffect, useMemo, useRef } from 'react'

import { createFromFetch } from '@vitejs/plugin-rsc/browser'

import { Events } from '../../utils/events'
import { Logger } from '../../utils/logger'

import type { RSCPayload } from '../env/rsc'
import { Preload } from './preload'
import { GoConfig, RouterContext } from './router-context'

const DEFAULT_GO_CONFIG = {
	replace: false,
} satisfies GoConfig

const logger = new Logger()

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
	 */
	const go = useCallback(
		async (to: string, goConfig?: GoConfig) => {
			id.current += 1
			const navigationId = id.current

			controller.current?.abort()
			controller.current = null

			const url = new URL(to, window.location.origin)
			const replace = goConfig?.replace ?? DEFAULT_GO_CONFIG.replace

			if (goConfig?.query) {
				for (const [key, value] of Object.entries(goConfig.query)) {
					url.searchParams.set(key, String(value))
				}
			}

			const path = Preload.toKey(url.toString(), window.location.origin)

			try {
				let promise = Preload.get(path)

				if (!promise) {
					const ctrl = new AbortController()
					controller.current = ctrl

					promise = fetch(path, {
						headers: { accept: 'text/x-component' },
						signal: ctrl.signal,
					})
				}

				if (!Preload.has(path)) Preload.set(path, promise)

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

				Events.dispatch('navigation', { path })
			} catch (err) {
				if (err instanceof Error && err.name === 'AbortError') {
					return path
				}

				logger.error('[navigation] failed', err)
				Events.dispatch('navigation:error', {
					path,
					error: err instanceof Error ? err.message : Logger.print(err),
				})
			} finally {
				if (navigationId === id.current) controller.current = null
				Preload.remove(path)
			}

			return path
		},
		[setPayload],
	)

	/**
	 * Preload a route's assets by fetching the RSC payload
	 */
	const preload = useCallback((path: string) => {
		const connection = window.navigator.connection

		if (document.visibilityState === 'hidden') return
		if (connection?.saveData) return
		if (['2g', 'slow-2g'].includes(connection?.effectiveType ?? '')) return

		const key = Preload.toKey(path, window.location.origin)

		if (Preload.has(key)) return
		Preload.set(key, fetch(key, { headers: { Accept: 'text/x-component' } }))
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
			preload,
			isNavigating,
		}),
		[go, preload, isNavigating],
	)

	return <RouterContext value={value}>{children}</RouterContext>
}
