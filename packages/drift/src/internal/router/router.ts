import type { DriftRequest, HttpMethod, PluginConfig } from '../../types'

import { Drift } from '../../drift'

import { isAction } from '../env/rsc'
import { HttpException } from '../navigation/http-exception'

export namespace Router {
	export type Params = Record<string, string | string[]>

	export type Handler = (req: DriftRequest) => Response | Promise<Response>

	export type ErrorHandler = (
		err: Error,
		req: DriftRequest,
	) => Response | Promise<Response>

	export type Middleware = (
		req: DriftRequest,
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
			// candidate routes bucketed by segment length
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

		// HEAD falls back to GET when HEAD is not explicitly defined
		if (method === 'HEAD') {
			const directGet = this.#routes.static.get(`GET:${path}`)
			if (directGet) return { route: directGet, params: {} }
		}

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
			if (route.method !== method && !(method === 'HEAD' && route.method === 'GET')) {
				continue
			}

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
			if (route.method !== method && !(method === 'HEAD' && route.method === 'GET')) {
				continue
			}

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
	async fetch(req: Request) {
		const url = new URL(req.url)
		const path = Router.#normalise(url.pathname, this.opts.trailingSlash)
		let match: Router.Match | null = null
		let action = false

		try {
			if (path !== url.pathname) {
				url.pathname = path
				req = new Request(url.toString(), req)
			}

			action = await isAction(req)
			const method = req.method.toUpperCase() as HttpMethod

			// action requests stay on the same pathname only the method is
			// normalised to GET this lets page/layout routes match for
			// rerender action execution still reads POST body and
			// may redirect()
			match = this.match(path, action ? 'GET' : method)

			if (!match) {
				const error = new HttpException(404, 'Not found')

				return (
					this.#onError?.(
						error,
						Object.assign(req, { [Drift.Config.$]: { match: null, error, action } }),
					) ?? new Response(error.message, { status: error.status })
				)
			}

			const matched = match
			const request = Object.assign(req, {
				[Drift.Config.$]: { match: matched, action },
			})
			const stack = [...this.#middleware.global, ...matched.route.middleware]

			return this.#run(
				stack,
				request,
				() =>
					matched.route.handler?.(request) ?? new Response('Not found', { status: 404 }),
			)
		} catch (err) {
			const error = err instanceof Error ? err : new Error(String(err), { cause: err })
			const request = Object.assign(req, { [Drift.Config.$]: { match, error, action } })

			if (this.#onError) return this.#onError(error, request)

			if (error instanceof HttpException) {
				return new Response(error.message, { status: error.status })
			}

			return new Response('Internal Server Error', { status: 500 })
		}
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
	static static(config: PluginConfig) {
		return async (req: Request) => {
			const pathname = new URL(req.url).pathname
			const outDir = config.outDir?.replace(/\/$/, '') ?? ''
			const filePath = `${outDir}/client${pathname}`

			return Router.serve(filePath, req, config.precompress, {
				'Cache-Control': 'public, immutable, max-age=31536000',
			})
		}
	}

	/**
	 * Serve a file with optional compression content negotiation
	 * @param filePath - absolute path to the file
	 * @param req - the request (for Accept-Encoding header)
	 * @param precompress - whether to look for .br variants
	 * @param headers - additional headers to add
	 * @returns response with the file or 404
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
