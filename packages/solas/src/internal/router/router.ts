import path from 'node:path'

import { match as createMatch, type MatchFunction } from 'path-to-regexp'

import type { HttpMethod, PluginConfig, SolasRequest } from '../../types.js'

import { Solas } from '../../solas.js'

import { getAlternatePathname, normalisePathname, toPathPattern } from './utils.js'

import { HttpException } from '../navigation/http-exception.js'
import { maybeAction } from '../server/actions.js'

export namespace Router {
	export type Params = Record<string, string | string[]>

	export type Handler = (req: SolasRequest) => Response | Promise<Response>

	export type ErrorHandler = (
		err: Error,
		req: SolasRequest,
	) => Response | Promise<Response>

	export type Middleware = (
		req: SolasRequest,
		next: () => Promise<Response>,
	) => Response | Promise<Response>

	export type Token = {
		kind: 'static' | 'dynamic' | 'wildcard'
		value: string
	}

	export type Route = {
		path: string
		method: string
		handler?: Handler
		middleware: Middleware[]
		tokens: Token[]
		length: number
		score: number
		wildcard: boolean
	}

	export type Match = {
		route: Route
		params: Params
	}

	export type Options = {
		trailingSlash?: NonNullable<PluginConfig['trailingSlash']>
	}

	export type Registry = {
		static: Map<string, Route>
		dynamic: {
			byLength: Map<number, Route[]>
			byPrefix: Map<string, Route[]>
		}
		wildcard: {
			byPrefix: Map<string, Route[]>
			fallback: Route[]
		}
	}
}

/**
 * Handle routing and matching for server requests
 */
export class Router {
	static #matchers = new WeakMap<Router.Route, MatchFunction<Router.Params>>()

	#routes: Router.Registry = {
		// exact match by method + path
		static: new Map(),
		dynamic: {
			// candidate routes bucketed by segment length
			byLength: new Map(),
			// fast path for static prefixes
			byPrefix: new Map(),
		},
		// wildcard routes checked last, narrowed by first literal segment when possible
		wildcard: {
			byPrefix: new Map(),
			fallback: [],
		},
	}
	#middleware: { global: Router.Middleware[] } = { global: [] }
	#onError?: (err: Error, req: SolasRequest) => Response | Promise<Response>

	constructor(public opts: Router.Options = {}) {
		this.fetch = this.fetch.bind(this)
	}

	/**
	 * Register middleware for all routes
	 */
	use(...middleware: Router.Middleware[]) {
		this.#middleware.global.push(...middleware)

		return this
	}

	/**
	 * Register an error handler for routing failures
	 */
	error(handler: Router.ErrorHandler) {
		this.#onError = handler
		return this
	}

	/**
	 * Register a route handler
	 */
	add(
		path: string,
		method: string,
		handler: Router.Handler,
		params?: string[],
		middleware: Router.Middleware[] = [],
	) {
		// normalise static routes up front so trailingSlash matching
		// uses the same pathname shape
		const routePath =
			!path.includes(':') && !path.includes('*')
				? normalisePathname(path, this.opts.trailingSlash ?? 'never')
				: path
		const segments = Router.#split(routePath)
		const tokens: Router.Token[] = []

		let score = 0
		let wildcard = false

		// turn the route path into tokens once so registration and matching can
		// share the same specificity rules
		for (const segment of segments) {
			if (segment === '*') {
				wildcard = true
				tokens.push({ kind: 'wildcard', value: params?.[0] ?? '*' })
				continue
			}

			if (segment.startsWith(':')) {
				tokens.push({ kind: 'dynamic', value: segment.slice(1) })
				score += 1
				continue
			}

			tokens.push({ kind: 'static', value: segment })
			score += 2
		}

		const route: Router.Route = {
			path: routePath,
			method: method.toUpperCase(),
			handler,
			middleware: [...middleware],
			tokens,
			length: segments.length,
			score,
			wildcard,
		}

		// static route, easy map set
		if (!path.includes(':') && !path.includes('*')) {
			this.#routes.static.set(`${route.method}:${route.path}`, route)
			return this
		}

		// wildcard route, push to end of list
		if (wildcard) {
			const prefix =
				route.tokens[0]?.kind === 'static' ? route.tokens[0].value : undefined

			if (prefix) {
				const prefixed = this.#routes.wildcard.byPrefix.get(prefix) ?? []
				prefixed.push(route)
				this.#routes.wildcard.byPrefix.set(prefix, prefixed)
			} else {
				this.#routes.wildcard.fallback.push(route)
			}

			return this
		}

		// dynamic routes are looked up through two indexes; one grouped
		// by segment count, and one grouped by the first static segment
		const bucket = this.#routes.dynamic.byLength.get(route.length) ?? []
		bucket.push(route)
		this.#routes.dynamic.byLength.set(route.length, bucket)

		// only routes that start with a literal segment go into the prefix index.
		// Routes that start dynamically still fall back to the length-based
		// lookup, so this shortcut doesn't accidentally skip a better match
		const prefix = route.tokens[0]?.kind === 'static' ? route.tokens[0].value : undefined

		if (prefix) {
			const prefixed = this.#routes.dynamic.byPrefix.get(prefix) ?? []
			prefixed.push(route)
			this.#routes.dynamic.byPrefix.set(prefix, prefixed)
		}

		return this
	}

	/**
	 * Match a path and method, returning params and route
	 */
	match(path: string, method: HttpMethod) {
		for (const candidate of Router.#candidates(path)) {
			const direct = this.#routes.static.get(`${method}:${candidate}`)

			if (direct) return { route: direct, params: {} }

			if (method === 'HEAD') {
				const directGet = this.#routes.static.get(`GET:${candidate}`)
				if (directGet) return { route: directGet, params: {} }
			}
		}

		// else dynamic/wildcard match
		const segments = Router.#split(path)

		// try the leading-static prefix bucket first
		const prefixed = this.#routes.dynamic.byPrefix.get(segments[0] ?? '')
		const prefixedMatch = prefixed ? Router.#pick(prefixed, segments, method) : null

		if (prefixedMatch) return prefixedMatch

		// if the prefix bucket has no winner, fall back to all dynamic
		// routes with the same segment count
		const dynamicMatch = Router.#pick(
			this.#routes.dynamic.byLength.get(segments.length) ?? [],
			segments,
			method,
		)

		if (dynamicMatch) return dynamicMatch

		// finally check wildcard routes, prefixed first, then fully generic ones
		const wildcardPrefixed = this.#routes.wildcard.byPrefix.get(segments[0] ?? '')
		const wildcardMatch = wildcardPrefixed
			? Router.#pick(wildcardPrefixed, segments, method)
			: null
		if (wildcardMatch) return wildcardMatch

		const wildcardFallbackMatch = Router.#pick(
			this.#routes.wildcard.fallback,
			segments,
			method,
		)
		if (wildcardFallbackMatch) return wildcardFallbackMatch

		// no match
		return null
	}

	/**
	 * Handle an incoming request
	 */
	async fetch(req: Request) {
		const url = new URL(req.url)
		const trailingSlash = this.opts.trailingSlash ?? 'never'
		const path =
			trailingSlash === 'ignore'
				? url.pathname
				: normalisePathname(url.pathname, trailingSlash)
		let match: Router.Match | null = null
		let action = false

		try {
			const method = req.method.toUpperCase() as HttpMethod

			if ((method === 'GET' || method === 'HEAD') && path !== url.pathname) {
				url.pathname = path
				return Response.redirect(url.toString(), 308)
			}

			if (path !== url.pathname) {
				// rebuild the request with the canonical pathname so downstream code
				// sees the same url the router matched against
				url.pathname = path
				req = new Request(url.toString(), req)
			}

			const { action: isAction, formData: parsedFormData } = await maybeAction(req)
			action = isAction

			// action requests stay on the same pathname only the method is
			// normalised to GET this lets page/layout routes match for
			// rerender action execution still reads POST body and
			// may redirect()
			match = this.match(path, action ? 'GET' : method)

			if (!match) {
				const error = new HttpException(404, 'Not found')

				// unmatched requests still pass through the shared error hook with the
				// same request metadata shape as matched requests
				return (
					this.#onError?.(
						error,
						Object.assign(req, {
							[Solas.Config.REQUEST_META]: { match: null, error, action },
						}),
					) ?? new Response(error.message, { status: error.status })
				)
			}

			const matched = match
			// attach routing state to the request once so middleware and handlers can
			// read the same per-request metadata
			const request: SolasRequest = Object.assign(req, {
				[Solas.Config.REQUEST_META]: { match: matched, action, parsedFormData },
			})

			// global middleware stays outside route middleware by preserving
			// registration order here before composition in #run
			const stack = [...this.#middleware.global, ...matched.route.middleware]

			return this.#run(
				stack,
				request,
				() =>
					matched.route.handler?.(request) ?? new Response('Not found', { status: 404 }),
			)
		} catch (err) {
			// normalise unknown throwables so the error hook always receives an Error
			const error = err instanceof Error ? err : new Error(String(err), { cause: err })
			const request = Object.assign(req, {
				[Solas.Config.REQUEST_META]: { match, error, action },
			})

			if (this.#onError) return this.#onError(error, request)

			if (error instanceof HttpException) {
				return new Response(error.message, { status: error.status })
			}

			return new Response('Internal Server Error', { status: 500 })
		}
	}

	/**
	 * Run middleware stack
	 */
	#run(
		stack: Router.Middleware[],
		req: SolasRequest,
		next: () => Promise<Response> | Response,
	) {
		// compose middleware stack
		let run = () => Promise.resolve(next())

		// unwind stack
		for (let i = stack.length - 1; i >= 0; i -= 1) {
			const handler = stack[i]
			const prev = run

			run = () => {
				let called = false

				return Promise.resolve(
					handler(req, () => {
						// guard against double invocation so handlers/inner middleware
						// only execute once per request
						if (called) throw new Error('next() called more than once')
						called = true

						return prev()
					}),
				)
			}
		}

		// run composed middleware stack
		return run()
	}

	/**
	 * Serve static assets from the output directory
	 * @note generated /assets/* handlers bypass +middleware conventions
	 */
	static static(config: PluginConfig) {
		return async (req: Request) => {
			const pathname = new URL(req.url).pathname
			const outDir = path.resolve(Solas.Config.OUT_DIR)
			const staticRoot = path.resolve(outDir, 'client')

			let decodedPathname = pathname

			try {
				// validate any percent-encoding before resolving the asset path
				decodedPathname = decodeURIComponent(pathname)
			} catch {
				return new Response('Bad Request', { status: 400 })
			}

			const relativePath = decodedPathname.replace(/^\/+/, '')
			const filePath = path.resolve(staticRoot, relativePath)

			// keep asset requests pinned under the client output root even if the
			// incoming path contains traversal segments
			if (filePath !== staticRoot && !filePath.startsWith(`${staticRoot}${path.sep}`)) {
				return new Response('Forbidden', { status: 403 })
			}

			// emitted assets are fingerprinted so they can be cached aggressively
			return Router.serve(filePath, req, config.precompress, {
				'Cache-Control': 'public, immutable, max-age=31536000',
			})
		}
	}

	/**
	 * Serve a file with optional compression content negotiation
	 */
	static async serve(
		filePath: string,
		req: Request,
		precompress: boolean = false,
		headers: Record<string, string> = {},
	) {
		const accept = req.headers.get('accept-encoding') ?? ''

		let file = Bun.file(filePath)
		let encoding: string | null = null

		if (precompress) {
			// prefer a precompressed variant when the client accepts it and one was emitted
			if (accept.includes('br')) {
				const brotli = Bun.file(`${filePath}.br`)

				if (await brotli.exists()) {
					file = brotli
					encoding = 'br'
				}
			}
		}

		if (!(await file.exists())) {
			return new Response('Not found', { status: 404 })
		}

		// get mime type from original path, not compressed variant
		const mimeType = Bun.file(filePath).type

		const res = new Response(file, {
			headers: {
				'Content-Type': headers['Content-Type'] ?? mimeType,
			},
		})

		for (const [key, value] of Object.entries(headers)) {
			res.headers.set(key, value)
		}

		if (precompress) res.headers.set('Vary', 'Accept-Encoding')
		if (encoding) res.headers.set('Content-Encoding', encoding)

		return res
	}

	/**
	 * Normalise a path based on router options
	 */
	static #candidates(path: string) {
		if (path === '/') return ['/']
		return [path, getAlternatePathname(path)]
	}

	/**
	 * Split a path into segments
	 */
	static #split(path: string) {
		if (path === '/') return []

		const parts: string[] = []
		let start = 0

		// walk the string once so we avoid empty segments from repeated or edge slashes
		for (let i = 0; i <= path.length; i += 1) {
			const char = path[i]
			if (char !== '/' && i !== path.length) continue

			if (i > start) {
				parts.push(path.slice(start, i))
			}

			start = i + 1
		}

		return parts
	}

	/**
	 * Get or create a path matcher for a route using path-to-regexp
	 */
	static #getMatcher(route: Router.Route) {
		const cached = Router.#matchers.get(route)
		if (cached) return cached

		// convert route tokens back into a path pattern for path-to-regexp to compile
		const { path } = toPathPattern(
			route.path,
			route.tokens.filter(token => token.kind !== 'static').map(token => token.value),
		)

		// create a matcher function for this route and cache it
		const matcher = createMatch<Router.Params>(path, {
			decode: false,
		})

		Router.#matchers.set(route, matcher)
		return matcher
	}

	/**
	 * Rank token kinds so more specific segments win before broader ones
	 */
	static #getTokenRank(token: Router.Token | undefined) {
		if (!token) return -1
		if (token.kind === 'static') return 2
		if (token.kind === 'dynamic') return 1
		return 0
	}

	/**
	 * Compare two routes and prefer the one with the more specific segment pattern
	 */
	static #compare(a: Router.Route, b: Router.Route) {
		const length = Math.max(a.tokens.length, b.tokens.length)

		for (let index = 0; index < length; index += 1) {
			// prefer static over dynamic and dynamic over wildcard at the
			// first segment position where the two routes differ
			const diff =
				Router.#getTokenRank(a.tokens[index]) - Router.#getTokenRank(b.tokens[index])
			if (diff !== 0) return diff
		}

		// if the token kinds line up, reuse the old coarse score
		if (a.score !== b.score) return a.score - b.score

		// final stable tie-break for routes with the same pattern shape
		// sort alphabetically by path string
		return a.path < b.path ? 1 : a.path > b.path ? -1 : 0
	}

	/**
	 * Find the best matching route from a candidate list using explicit specificity rules
	 */
	static #pick(routes: Router.Route[], segments: string[], method: HttpMethod) {
		let best: Router.Route | null = null
		let bestParams: Router.Params | null = null

		for (const route of routes) {
			// HEAD can reuse GET routes when HEAD is not registered explicitly
			if (route.method !== method && !(method === 'HEAD' && route.method === 'GET')) {
				continue
			}

			// skip routes that do not fit this path. Only compare specificity
			// across matched routes
			const params = Router.#fit(route, segments)
			if (!params) continue

			// replace the winner only when this route is strictly more specific
			if (!best || Router.#compare(route, best) > 0) {
				best = route
				bestParams = params
			}
		}

		if (!best) return null

		return { route: best, params: bestParams ?? {} }
	}

	/**
	 * Fit a route against path segments
	 */
	static #fit(route: Router.Route, segments: string[]) {
		if (route.wildcard) {
			// wildcard routes only require the fixed prefix before the catch-all segment
			if (segments.length < route.length - 1) return null
		} else if (route.length !== segments.length) {
			return null
		}

		// defer the actual param extraction to the cached path-to-regexp matcher so
		// dynamic and wildcard params stay consistent with registration
		const matched = Router.#getMatcher(route)(
			segments.length ? `/${segments.join('/')}` : '/',
		)
		if (!matched) return null

		return matched.params
	}
}
