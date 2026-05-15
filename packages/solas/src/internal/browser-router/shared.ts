import { BasePath } from '../../utils/base-path.js'

import { Solas } from '../../solas.js'

const BASE_PATH = BasePath.normalise(import.meta.env.BASE_URL)

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
		TPath extends `${infer Start}:${string}/${infer Rest}`
			? `${Start}${string}/${ResolvedPath<Rest>}`
			: TPath extends `${infer Start}:${string}`
				? `${Start}${string}`
				: TPath extends `${infer Start}*${infer Rest}`
					? `${Start}${string}${ResolvedPath<Rest>}`
					: TPath

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
		| TPath
		| `${TPath}?${string}`
		| `${TPath}#${string}`
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
		query?: Query
	} & (Solas.Routes[TPath] extends {
		params: infer TParams extends Params
	}
		? { params: TParams }
		: { params?: never })

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
		| ({ href: Target } & TargetConfig)
		| (keyof Solas.Routes extends never
				? never
				: {
						[TPath in Path]: {
							href: TPath
						} & PatternConfig<TPath>
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
		<TTo extends Path>(to: TTo, opts?: PatternConfig<TTo> & Replace): Promise<string>
		<TTo extends Target>(to: TTo, opts?: TargetConfig & Replace): Promise<string>
		<TTo extends string>(
			to: string extends TTo ? TTo : never,
			opts?: GoOptions,
		): Promise<string>
	}

	/**
	 * Convert a route pattern and params into a real path string. This is used internally
	 * to implement <Link /> and router.go
	 */
	export function toTarget(path: string, params?: Record<string, string>, query?: Query) {
		const used = new Set<string>()

		let to = path.replaceAll(/:([A-Za-z0-9_]+)/g, (_, key: string) => {
			const value = params?.[key]

			if (value == null) {
				throw new Error(`[Link]: missing route param: ${key}`)
			}

			used.add(key)
			return encodeURIComponent(value)
		})

		if (to.includes('*')) {
			const remaining = Object.entries(params ?? {}).filter(([key]) => !used.has(key))

			if (remaining.length !== 1) {
				throw new Error('[Link]: wildcard routes require exactly one unmatched param')
			}

			to = to.replace('*', remaining[0][1].split('/').map(encodeURIComponent).join('/'))
		}

		if (!query) return withBase(to)

		const hashIndex = to.indexOf('#')
		const hash = hashIndex >= 0 ? to.slice(hashIndex) : ''
		const pathWithSearch = hashIndex >= 0 ? to.slice(0, hashIndex) : to
		const searchIndex = pathWithSearch.indexOf('?')
		const pathname =
			searchIndex >= 0 ? pathWithSearch.slice(0, searchIndex) : pathWithSearch
		const currentSearch = searchIndex >= 0 ? pathWithSearch.slice(searchIndex + 1) : ''
		const search = new URLSearchParams(currentSearch)

		for (const [key, value] of Object.entries(query)) {
			search.set(key, String(value))
		}

		const value = search.toString()
		return withBase(`${pathname}${value.length > 0 ? `?${value}` : ''}${hash}`)
	}
}

/**
 * Apply the base path to a target string when needed
 */
export function withBase(target: string) {
	if (BrowserRouter.isHashOnlyTarget(target)) return target
	if (target.startsWith('//') || /^[A-Za-z][A-Za-z\d+.-]*:/.test(target)) return target

	const suffixIndex = target.search(/[?#]/)
	const pathname = suffixIndex === -1 ? target : target.slice(0, suffixIndex)
	const suffix = suffixIndex === -1 ? '' : target.slice(suffixIndex)

	return `${BasePath.apply(pathname || '/', BASE_PATH)}${suffix}`
}
