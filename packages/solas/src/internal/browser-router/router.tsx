'use client'

import { createContext, useCallback, useEffect, useMemo, useRef } from 'react'

import { createFromFetch } from '@vitejs/plugin-rsc/browser'

import { Logger } from '../../utils/logger.js'

import type { RscPayload } from '../env/rsc.js'
import { Solas } from '../../solas.js'
import { Prefetcher } from './../prefetcher.js'

export namespace BrowserRouter {
	// route params are simple string values that get dropped into the path
	export type Params = Record<string, string>
	// query values can start as strings, numbers or booleans
	export type Query = Record<string, string | number | boolean>
	// only use route keys that actually exist in Solas.Routes
	export type Path = keyof Solas.Routes & string
	// shared option for choosing replaceState instead of pushState
	type Replace = { replace?: boolean }

	export type GoOptions = {
		replace?: boolean
		query?: Query
		params?: Params
	}

	/**
	 * These targets are used as-is. They are not matched against the route table,
	 * so this covers normal external URLs and hash-only links
	 */
	export type ExternalTarget = `${string}:${string}` | `//${string}` | `#${string}`

	export function isHashOnlyTarget(target: string) {
		return target.startsWith('#')
	}

	export function isExternalTarget(target: string, origin: string) {
		if (isHashOnlyTarget(target)) return false

		try {
			return new URL(target, origin).origin !== origin
		} catch {
			return false
		}
	}

	/**
	 * Turn a route pattern into the real path shape a caller can use. In practice,
	 * every ':param' or '*' part becomes a plain string slot
	 *
	 * @example
	 * ```ts
	 * // '/p/:id' becomes '/p/${string}'
	 * // '/test/*' becomes '/test/${string}'
	 * // '/posts' stays '/posts'
	 * ```
	 *
	 * @example
	 * ```ts
	 * type A = ResolvedPath<'/posts/:id'>
	 * // '/posts/${string}'
	 * ```
	 *
	 * @example
	 * ```ts
	 * type B = ResolvedPath<'/docs/*'>
	 * // '/docs/${string}'
	 * ```
	 */
	export type ResolvedPath<TPath extends string> =
		// if there is a ':param' and more path after it, replace that param and recurse on the rest
		TPath extends `${infer Start}:${string}/${infer Rest}`
			? `${Start}${string}/${ResolvedPath<Rest>}`
			: // if this is the last ':param', replace it and stop
				TPath extends `${infer Start}:${string}`
				? `${Start}${string}`
				: // do the same for '*', then recurse if there is more path after it
					TPath extends `${infer Start}*${infer Rest}`
					? `${Start}${string}${ResolvedPath<Rest>}`
					: // no params left, so the remaining static path stays as it is
						TPath

	/**
	 * Once we have a real path, also allow the usual query-string and hash forms
	 *
	 * @example
	 * ```ts
	 * type A = TargetSuffix<'/posts/123'>
	 * // '/posts/123' | '/posts/123?${string}' | '/posts/123#${string}' | '/posts/123?${string}#${string}'
	 * ```
	 */
	export type TargetSuffix<TPath extends string> =
		// just the path on its own
		| TPath
		// the path with a query string
		| `${TPath}?${string}`
		// the path with a hash fragment
		| `${TPath}#${string}`
		// the path with both query string and hash
		| `${TPath}?${string}#${string}`

	/**
	 * This is the final string form a caller can navigate to. It can be an external
	 * URL, or a concrete URL that matches one of the  known routes
	 *
	 * @example
	 * ```ts
	 * type A = Target
	 * // 'https://example.com'
	 * // '#intro'
	 * // '/posts/123'
	 * // '/posts/123?draft=true'
	 * ```
	 */
	export type Target = ExternalTarget | TargetSuffix<ResolvedPath<Path>>

	/**
	 * Extra options for callers who already have a finished target string
	 *
	 * @example
	 * ```ts
	 * const a: TargetConfig = { query: { page: 2 } }
	 * // params is rejected here because the path is already complete
	 * ```
	 */
	type TargetConfig = {
		params?: never
		query?: Query
	}

	/**
	 * Extra options for callers who pass a route pattern and params separately.
	 * If the route definition says that route needs params, this type makes
	 * those params required. If the route has no params, it rejects them
	 *
	 * @example
	 * ```ts
	 * // if Solas.Routes['/posts/:id'] is { params: { id: string } }
	 * type A = PatternConfig<'/posts/:id'>
	 * // { query?: Query } & { params: { id: string } }
	 * ```
	 *
	 * @example
	 * ```ts
	 * // if Solas.Routes['/about'] has no params field
	 * type B = PatternConfig<'/about'>
	 * // { query?: Query } & { params?: never }
	 * ```
	 */
	type PatternConfig<TPath extends Path> = {
		// query is always allowed
		query?: Query
	} &
		// check the route definition for a params object
		(Solas.Routes[TPath] extends {
			// if it exists, capture its exact shape as TParams
			params: infer TParams extends Params
		}
			? // routes with params must receive those params
				{ params: TParams }
			: // routes without params must not receive them
				{ params?: never })

	/**
	 * Typed <Link /> props, using `href` instead of the internal `to` name
	 *
	 * `query` is always allowed
	 * `params` are only allowed when `href` is a known route pattern
	 *
	 * @example
	 * ```ts
	 * const a: LinkProps = { href: '/posts/:id', params: { id: '123' } }
	 * const b: LinkProps = { href: '/posts/123?draft=true' }
	 * ```
	 */
	export type LinkProps =
		// if the caller already has a real target string, allow it with TargetConfig
		| ({ href: Target } & TargetConfig)
		// otherwise, build one allowed object shape per known route pattern
		| (keyof Solas.Routes extends never
				? never
				: {
						// for each route key, make an object where `href` is that exact route
						[TPath in Path]: {
							href: TPath
							// then add the query/params rules for that specific route
						} & PatternConfig<TPath>
						// indexing with [Path] turns the mapped object into a union of its values
					}[Path])

	/**
	 * Typed input for router.go(), using the same route rules as <Link />
	 *
	 * @example
	 * ```ts
	 * go('/p/post-2')
	 * go('/?foo=bar', { replace: true })
	 * ```
	 *
	 * @example
	 * ```ts
	 * go('/p/:id', { params: { id: 'post-2' }, replace: true })
	 * ```
	 *
	 * The last overload is the fallback for plain `string` values. The
	 * `string extends TTo` check stops that fallback from taking over
	 * when TypeScript already knows the caller passed a more specific
	 * string literal
	 *
	 * @example
	 * ```ts
	 * declare const dynamicPath: string
	 * go(dynamicPath, { replace: true })
	 * ```
	 */
	export type Go = {
		// known route pattern, so use that route's exact params rules
		<TTo extends Path>(to: TTo, opts?: PatternConfig<TTo> & Replace): Promise<string>
		// already-resolved target string, so params are not allowed here
		<TTo extends Target>(to: TTo, opts?: TargetConfig & Replace): Promise<string>
		// plain string fallback for values TypeScript cannot narrow any further
		<TTo extends string>(
			// only use this branch when the caller really has a plain string
			to: string extends TTo ? TTo : never,
			// this fallback accepts the loose runtime options shape
			opts?: GoOptions,
		): Promise<string>
	}

	/**
	 * Convert a route pattern and params into a real path string. This is used internally
	 * to implement <Link /> and router.go
	 */
	export function toTarget(
		path: string,
		params?: Record<string, string>,
		query?: BrowserRouter.Query,
	) {
		// keep track of which params were consumed by named `:param` slots
		const used = new Set<string>()

		// replace each named route param with its URL-encoded value
		let to = path.replaceAll(/:([A-Za-z0-9_]+)/g, (_, key: string) => {
			const value = params?.[key]

			if (value == null) {
				throw new Error(`[Link]: missing route param: ${key}`)
			}

			used.add(key)
			return encodeURIComponent(value)
		})

		if (to.includes('*')) {
			// wildcard routes use the one param that was not already matched by a named slot
			const remaining = Object.entries(params ?? {}).filter(([key]) => !used.has(key))

			if (remaining.length !== 1) {
				throw new Error('[Link]: wildcard routes require exactly one unmatched param')
			}

			// encode each path segment separately so embedded '/' still acts like a path separator
			to = to.replace('*', remaining[0][1].split('/').map(encodeURIComponent).join('/'))
		}

		if (!query) return to

		// split the URL up so new query params can be merged without losing an existing hash
		const hashIndex = to.indexOf('#')
		const hash = hashIndex >= 0 ? to.slice(hashIndex) : ''
		const pathWithSearch = hashIndex >= 0 ? to.slice(0, hashIndex) : to
		const searchIndex = pathWithSearch.indexOf('?')
		const pathname =
			searchIndex >= 0 ? pathWithSearch.slice(0, searchIndex) : pathWithSearch
		const currentSearch = searchIndex >= 0 ? pathWithSearch.slice(searchIndex + 1) : ''
		const search = new URLSearchParams(currentSearch)

		// later values win, so passed query props overwrite any existing query string values
		for (const [key, value] of Object.entries(query)) {
			search.set(key, String(value))
		}

		const value = search.toString()
		// rebuild the URL in the same order: pathname, optional query string, then hash
		return `${pathname}${value.length > 0 ? `?${value}` : ''}${hash}`
	}
}

export const BrowserRouterContext = createContext<{
	// same overloaded navigation API exposed through context
	go: BrowserRouter.Go
	// string-based prefetch stays loose because callers usually already have a resolved href
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
	const go: BrowserRouter.Go = useCallback(
		async (to: string, opts: BrowserRouter.GoOptions = {}) => {
			// increment navigation id to invalidate any in-flight navigations
			id.current += 1
			const navigationId = id.current

			// fallback for abort/error paths
			const currentPath = window.location.pathname + window.location.search
			let path = currentPath
			const replace = opts?.replace ?? DEFAULT_GO_CONFIG.replace

			controller.current?.abort()
			controller.current = null

			// distinguish an actual prior prefetch from a cache entry we create
			// opportunistically for this navigation
			let existing = false

			try {
				const target = BrowserRouter.toTarget(to, opts.params, opts.query)

				if (BrowserRouter.isExternalTarget(target, window.location.origin)) {
					throw new Error('[router.go]: external URLs are not supported. Use <a> instead')
				}

				const url = new URL(target, window.location.origin)

				const key = Prefetcher.key(url.toString(), window.location.origin)
				if (!key) throw new Error('Invalid navigation url')

				// switch to the normalised target once the url is valid
				path = key

				// internal client navigation should update the route immediately, even
				// if the subsequent fetch resolves to a 404 or other error state
				if (path !== currentPath) {
					if (replace) {
						window.history.replaceState(null, '', path)
					} else {
						window.history.pushState(null, '', path)
					}
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
				const [res, payload] = await Promise.all([
					promise,
					createFromFetch<RscPayload>(promise),
				])
				// use the final response url so client history matches server redirects
				const resolvedPath = Prefetcher.key(res.url, window.location.origin) ?? path

				// check again if another navigation has started while we were awaiting
				// the response
				if (navigationId !== id.current) return resolvedPath

				if (resolvedPath !== path) {
					window.history.replaceState(null, '', resolvedPath)
				}

				// this state update is already wrapped in a
				// transition before being passed as props
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
