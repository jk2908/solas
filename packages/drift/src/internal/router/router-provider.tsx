'use client'

import { useCallback, useEffect, useMemo } from 'react'

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
	/**
	 * Navigate to a new route
	 */
	const go = useCallback(
		async (to: string, goConfig?: GoConfig) => {
			const url = new URL(to, window.location.origin)
			const replace = goConfig?.replace ?? DEFAULT_GO_CONFIG.replace

			if (goConfig?.query) {
				for (const [key, value] of Object.entries(goConfig.query)) {
					url.searchParams.set(key, String(value))
				}
			}

			const path = Preload.toKey(url.toString(), window.location.origin)

			try {
				const promise =
					Preload.get(path) ?? fetch(path, { headers: { accept: 'text/x-component' } })

				if (!Preload.has(path)) Preload.set(path, promise)

				const res = await createFromFetch<RSCPayload>(promise)

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
				logger.error('[navigation] failed', err)
				Events.dispatch('navigation:error', {
					path,
					error: err instanceof Error ? err.message : String(err),
				})
			} finally {
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
		const connection = (
			navigator as Navigator & {
				connection?: {
					saveData?: boolean
					effectiveType?: string
				}
			}
		).connection

		if (document.visibilityState === 'hidden') return
		if (connection?.saveData) return
		if (connection?.effectiveType === 'slow-2g' || connection?.effectiveType === '2g') {
			return
		}

		const key = Preload.toKey(path, window.location.origin)

		if (Preload.has(key)) return
		Preload.set(key, fetch(key, { headers: { Accept: 'text/x-component' } }))
	}, [])

	useEffect(() => {
		const handler = () => go(window.location.href, { replace: true })
		window.addEventListener('popstate', handler)

		return () => {
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
