import type { DriftRequest, HttpMethod, PluginConfig } from '../types'

import { HttpException } from '../shared/http-exception'

export namespace Router {
	export type Params = Record<string, string | string[]>

	export type Handler = (req: Request) => Response | Promise<Response>

	export type ErrorHandler = (err: Error, req: Request) => Response | Promise<Response>

	export type Middleware = (
		req: Request,
		next: () => Promise<Response>,
	) => Response | Promise<Response>

	export type Token = {
		kind: 'static' | 'dynamic' | 'catch-all'
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
		catchAll: boolean
	}

	export type Match = {
		route: Route
		params: Params
	}

	export type Options = {
		trailingSlash?: boolean
	}

	export type Registry = {
		static: Map<string, Route>
		dynamic: {
			byLength: Map<number, Route[]>
			byPrefix: Map<string, Route[]>
		}
		catchAll: Route[]
	}
}

/**
 * Handle routing and matching for server requests
 */
export class Router {
	#routes: Router.Registry = {
		// exact match by method + path
		static: new Map(),
		dynamic: {
			// candidate routes bucketed by segment lengt
			byLength: new Map(),
			// fast path for static prefixes
			byPrefix: new Map(),
		},
		// catch-all routes checked last
		catchAll: [],
	}
	#middleware: { global: Router.Middleware[] } = { global: [] }
	#onError?: (err: Error, req: DriftRequest) => Response | Promise<Response>

	constructor(public opts: Router.Options = {}) {
		this.fetch = this.fetch.bind(this)
	}

	/**
	 * Register middleware for all routes
	 * @param middleware - middleware stack
	 */
	use(...middleware: Router.Middleware[]) {
		this.#middleware.global.push(...middleware)

		return this
	}

	/**
	 * Register an error handler for routing failures
	 * @param handler - error handler
	 */
	error(handler: Router.ErrorHandler) {
		this.#onError = handler
		return this
	}

	/**
	 * Register a route handler
	 * @param path - the route path
	 * @param method - the http method
	 * @param handler - the request handler
	 * @param params - optional param name for catch-all routes (dynamic params come from :segment names)
	 */
	add(
		path: string,
		method: string,
		handler: Router.Handler,
		params?: string[],
		middleware: Router.Middleware[] = [],
	) {
		const segments = Router.#split(path)
		const tokens: Router.Token[] = []

		let score = 0
		let catchAll = false

		for (const segment of segments) {
			if (segment === '*') {
				catchAll = true
				tokens.push({ kind: 'catch-all', value: params?.[0] ?? '*' })
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
			path,
			method: method.toUpperCase(),
			handler,
			middleware: [...middleware],
			tokens,
			length: segments.length,
			score,
			catchAll,
		}

		// static route, easy map set
		if (!path.includes(':') && !path.includes('*')) {
			this.#routes.static.set(`${route.method}:${path}`, route)
			return this
		}

		// catch-all route, push to end of list
		if (catchAll) {
			this.#routes.catchAll.push(route)
			return this
		}

		// dynamic route, add to match tables
		const bucket = this.#routes.dynamic.byLength.get(route.length) ?? []
		bucket.push(route)
		this.#routes.dynamic.byLength.set(route.length, bucket)

		// add to prefix map for fast lookup
		const prefix = route.tokens.find(t => t.kind === 'static')?.value

		if (prefix) {
			const prefixed = this.#routes.dynamic.byPrefix.get(prefix) ?? []
			prefixed.push(route)
			this.#routes.dynamic.byPrefix.set(prefix, prefixed)
		}

		return this
	}

	/**
	 * Match a path and method, returning params and route
	 * @param path - the request path
	 * @param method - the http method
	 * @returns the matched route and params
	 */
	match(path: string, method: HttpMethod) {
		const direct = this.#routes.static.get(`${method}:${path}`)

		// direct match - quick return
		if (direct) return { route: direct, params: {} }

		// else dynamic/catch-all match
		const segments = Router.#split(path)

		// check dynamic routes first by prefix and then by length
		const prefixed = this.#routes.dynamic.byPrefix.get(segments[0] ?? '')
		// if there is a prefix match, only check those routes,
		// else check all routes of the same length
		const candidates =
			prefixed ?? this.#routes.dynamic.byLength.get(segments.length) ?? []

		let best: Router.Route | null = null
		let bestParams: Router.Params | null = null

		for (const route of candidates) {
			// method must match
			if (route.method !== method) continue

			const params = Router.#fit(route, segments)
			if (!params) continue

			// if there's already a best match, only replace if
			// the score is higher
			if (!best || route.score > best.score) {
				best = route
				bestParams = params
			}
		}

		if (best) return { route: best, params: bestParams ?? {} }

		// finally check catch-all routes
		for (const route of this.#routes.catchAll) {
			if (route.method !== method) continue

			const params = Router.#fit(route, segments)
			if (params) return { route, params }
		}

		// no match
		return null
	}

	/**
	 * Handle an incoming request
	 * @param req - the request to handle
	 * @returns the response
	 */
	fetch(req: Request) {
		const url = new URL(req.url)
		const path = Router.#normalise(url.pathname, this.opts.trailingSlash)

		if (path !== url.pathname) {
			url.pathname = path
			req = new Request(url.toString(), req)
		}

		const match = this.match(path, req.method.toUpperCase() as HttpMethod)

		if (!match) {
			const error = new HttpException(404, 'Not found')

			return (
				this.#onError?.(error, Object.assign(req, { match: null, error })) ??
				new Response(error.message, { status: error.status })
			)
		}

		const request = Object.assign(req, { match })
		const stack = [...this.#middleware.global, ...match.route.middleware]

		return this.#run(
			stack,
			request,
			() => match.route.handler?.(request) ?? new Response('Not found', { status: 404 }),
		)
	}

	/**
	 * Run middleware stack
	 * @param stack - middleware stack
	 * @param req - the request
	 * @param next - next handler
	 * @returns the response
	 */
	#run(
		stack: Router.Middleware[],
		req: DriftRequest,
		next: () => Promise<Response> | Response,
	) {
		// compose middleware stack
		let run = () => Promise.resolve(next())

		// unwind stack
		for (let i = stack.length - 1; i >= 0; i -= 1) {
			const handler = stack[i]
			const prev = run
			run = () => Promise.resolve(handler(req, prev))
		}

		// run composed middleware stack
		return run()
	}

	/**
	 * Serve static assets from the output directory
	 * @param config - the plugin config
	 * @returns a request handler for static assets
	 */
	static serveStatic(config: PluginConfig) {
		return async (req: Request) => {
			const pathname = new URL(req.url).pathname
			const assetPath = pathname.startsWith('/assets/') ? pathname.slice(8) : pathname
			const outDir = config.outDir?.replace(/\/$/, '') ?? ''
			const filePath = `${outDir}/${assetPath}`
			const accept = req.headers.get('accept-encoding') ?? ''

			let file = Bun.file(filePath)
			let encoding: string | null = null

			if (config.precompress) {
				if (accept.includes('br')) {
					const brotli = Bun.file(`${filePath}.br`)

					if (await brotli.exists()) {
						file = brotli
						encoding = 'br'
					}
				}

				if (!encoding && accept.includes('gzip')) {
					const gzip = Bun.file(`${filePath}.gz`)

					if (await gzip.exists()) {
						file = gzip
						encoding = 'gzip'
					}
				}
			}

			if (!(await file.exists())) return new Response('Not found', { status: 404 })

			const res = new Response(file)
			res.headers.set('Cache-Control', 'public, immutable, max-age=31536000')

			if (encoding) res.headers.set('Content-Encoding', encoding)
			if (file.type) res.headers.set('Content-Type', file.type)

			return res
		}
	}

	/**
	 * Normalise a path based on router options
	 * @param path - the path to normalise
	 * @returns the normalised path
	 */
	static #normalise(path: string, trailingSlash: boolean = true) {
		if (!trailingSlash) {
			return path.endsWith('/') && path !== '/' ? path.slice(0, -1) : path
		}

		if (path === '/') return path

		return path.endsWith('/') ? path : `${path}/`
	}

	/**
	 * Split a path into segments
	 * @param path - the path to split
	 * @returns the path segments
	 */
	static #split(path: string) {
		if (path === '/') return []

		const parts: string[] = []
		let start = 0

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
	 * Fit a route against path segments
	 * @param route - the route to fit
	 * @param segments - the path segments
	 * @returns the extracted params or null if not matched
	 */
	static #fit(route: Router.Route, segments: string[]) {
		if (route.catchAll) {
			if (segments.length < route.length - 1) {
				return null
			}
		} else if (route.length !== segments.length) {
			return null
		}

		const params: Router.Params = {}

		for (let index = 0; index < route.tokens.length; index += 1) {
			const token = route.tokens[index]
			const value = segments[index]

			if (token.kind === 'static') {
				if (token.value !== value) return null
				continue
			}

			if (token.kind === 'dynamic') {
				if (!value) return null
				params[token.value] = value
				continue
			}

			params[token.value] = segments.slice(index).join('/')
			return params
		}

		return params
	}
}
