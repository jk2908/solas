'use client'

import { startTransition, useCallback, useEffect, useMemo, useRef } from 'react'

import { createFromFetch } from '@vitejs/plugin-rsc/browser'

import { Solas } from '../../solas'

import { Logger } from '../../utils/logger'

import type { RSCPayload } from '../env/rsc'
import type { RouteEntry } from './entry'
import { type NavigationTiming, now, type WarmTiming } from './metrics'
import { Prefetcher } from './prefetcher'
import { type Navigation, RouterContext } from './router-context'

const DEFAULT_GO_CONFIG = {
	replace: false,
} satisfies Navigation.GoOptions

const logger = new Logger()
const prefetcher = new Prefetcher()

export function RouterProvider({
	children,
	currentPath,
	retainedEntry,
	setCurrentEntry,
	setRetainedEntry,
	onNavigationReady,
	onWarmReady,
	isNavigating = false,
}: {
	children: React.ReactNode
	currentPath?: string | null
	retainedEntry?: RouteEntry | null
	setCurrentEntry?: (entry: RouteEntry) => void
	setRetainedEntry?: (entry: RouteEntry | null) => void
	onNavigationReady?: (timing: NavigationTiming) => void
	onWarmReady?: (timing: WarmTiming) => void
	isNavigating?: boolean
}) {
	// id to track active navigations
	const id = useRef(0)
	// id to track the latest warm render request
	const warmId = useRef(0)
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
			const startedAt = now()
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

				const retainedMatch =
					retainedEntry &&
					(retainedEntry.requestedPath === path || retainedEntry.path === path)

				if (retainedMatch) {
					onNavigationReady?.({
						id: navigationId,
						startedAt,
						path,
						resolvedPath: retainedEntry.path,
						prefetched: true,
						warmHit: true,
						fetchMs: 0,
						parseMs: 0,
						readyMs: 0,
					})

					setCurrentEntry?.(retainedEntry)

					if (replace) {
						window.history.replaceState(null, '', retainedEntry.path)
					} else {
						window.history.pushState(null, '', retainedEntry.path)
					}

					window.dispatchEvent(
						new CustomEvent(Solas.Events.names.NAVIGATION, {
							detail: { path: retainedEntry.path },
						}),
					)

					return retainedEntry.path
				}

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
				const response = await promise
				const fetchedAt = now()
				const payload = await createFromFetch<RSCPayload>(Promise.resolve(response.clone()))
				const parsedAt = now()
				// use the final response url so client history matches server redirects
				const resolvedPath =
					Prefetcher.key(response.url, window.location.origin) ?? path

				// check again if another navigation has started while we were awaiting
				// the response
				if (navigationId !== id.current) return resolvedPath

				// this state update is already wrapped in a
				// transition before being passed as props
				onNavigationReady?.({
					id: navigationId,
					startedAt,
					path,
					resolvedPath,
					prefetched: existing,
					warmHit: false,
					fetchMs: fetchedAt - startedAt,
					parseMs: parsedAt - fetchedAt,
					readyMs: parsedAt - startedAt,
				})
				setCurrentEntry?.({
					id: navigationId,
					path: resolvedPath,
					requestedPath: path,
					payload,
				})

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
		[onNavigationReady, retainedEntry, setCurrentEntry],
	)

	/**
	 * Prefetch a route's RSC payload
	 * @param path the route path to prefetch (absolute or relative to origin)
	 */
	const prefetch = useCallback(
		async (path: string) => {
			const startedAt = now()
			const key = Prefetcher.key(path, window.location.origin)

			if (!key) return
			if (key === currentPath) return
			if (
				retainedEntry &&
				(retainedEntry.requestedPath === key || retainedEntry.path === key)
			) {
				return
			}

			let promise = prefetcher.get(key)
			const cacheHit = promise !== undefined

			if (!promise) {
				prefetcher.set(
					key,
					fetch(key, {
						headers: { accept: 'text/x-component' },
					}),
				)

				promise = prefetcher.get(key)
			}

			if (!promise) return

			const nextWarmId = warmId.current + 1
			warmId.current = nextWarmId

			try {
				const response = await promise
				const fetchedAt = now()
				const payload = await createFromFetch<RSCPayload>(Promise.resolve(response.clone()))
				const parsedAt = now()
				const resolvedPath =
					Prefetcher.key(response.url, window.location.origin) ?? key

				if (nextWarmId !== warmId.current) return
				if (resolvedPath === currentPath) return

				onWarmReady?.({
					id: nextWarmId,
					startedAt,
					path: resolvedPath,
					cacheHit,
					fetchMs: fetchedAt - startedAt,
					parseMs: parsedAt - fetchedAt,
					readyMs: parsedAt - startedAt,
				})

				startTransition(() => {
					setRetainedEntry?.({
						id: nextWarmId,
						path: resolvedPath,
						requestedPath: key,
						payload,
					})
				})
			} catch (err) {
				logger.error('[prefetch] failed to warm route', err)
			}
		},
		[currentPath, onWarmReady, retainedEntry, setRetainedEntry],
	)

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
