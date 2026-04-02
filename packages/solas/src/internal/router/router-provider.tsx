'use client'

import { useCallback, useEffect, useMemo, useRef } from 'react'

import { createFromFetch } from '@vitejs/plugin-rsc/browser'

import { Solas } from '../../solas'

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
			// increment navigation id to invalidate any in-flight navigations
			id.current += 1
			const navigationId = id.current

			// fallback for abort/error paths
			let path = window.location.pathname + window.location.search
			const replace = opts?.replace ?? DEFAULT_GO_CONFIG.replace

			controller.current?.abort()
			controller.current = null

			// distinguish an actual prior prefetch from a cache entry we create
			// opportunistically for this navigation
			let existing = false

			try {
				const url = new URL(to, window.location.origin)

				if (opts?.query) {
					for (const [key, value] of Object.entries(opts.query)) {
						url.searchParams.set(key, String(value))
					}
				}

				const key = Prefetcher.key(url.toString(), window.location.origin)
				if (!key) throw new Error('Invalid navigation url')

				// switch to the normalized target once the url is valid
				path = key

				// if the target was already prefetched, use the cached response promise
				// and set existing to true so we don't remove it from cache
				// after navigation
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

				// if another navigation has started since this one, ignore the result
				// and return early
				if (navigationId !== id.current) return path

				// we need both the parsed payload and the final response url because
				// redirects can change the canonical path we should store in history
				const [res, payload] = await Promise.all([
					promise,
					createFromFetch<RSCPayload>(promise),
				])
				// use the final response url so client history matches server redirects
				const resolvedPath = Prefetcher.key(res.url, window.location.origin) ?? path

				// check again if another navigation has started while we were awaiting
				// the response
				if (navigationId !== id.current) return resolvedPath

				// this state update is already wrapped in a
				// transition before being passed as props
				setPayload?.(payload)

				if (replace) {
					window.history.replaceState(null, '', resolvedPath)
				} else {
					window.history.pushState(null, '', resolvedPath)
				}

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

				// keep entries that were already in the prefetch cache before go() ran. Only remove
				// the temporary cache entry go() created for its own in-flight dedupe
				if (!existing) {
					// this fetch was not an intentional prefetch, so do not leave it behind
					// as a reusable cache entry after navigation finishes
					prefetcher.remove(path)
				}
			}

			return path
		},
		[setPayload],
	)

	/**
	 * Prefetch a route's RSC payload
	 * @param path the route path to prefetch (absolute or relative to origin)
	 */
	const prefetch = useCallback((path: string) => {
		const key = Prefetcher.key(path, window.location.origin)
		if (!key) return

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
