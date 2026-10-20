import type { Http2ServerRequest, Http2ServerResponse } from 'node:http2'

import http from 'node:http'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export type ServeOptions = {
	/**
	 * Port to listen on. Defaults to `process.env.PORT` or `3000`.
	 */
	port?: number
	/**
	 * Host to bind to. Defaults to `0.0.0.0`.
	 */
	host?: string
	/**
	 * Build output directory the handler reads from. Defaults to `dist`, resolved
	 * relative to the current working directory.
	 */
	outDir?: string
	/**
	 * Explicit path to the built RSC entry. Defaults to `<outDir>/rsc/index.js`.
	 */
	entry?: string
	/**
	 * Called once the server is listening.
	 */
	onListen?: (info: { port: number; host: string }) => void
}

export type Server = http.Server & AsyncDisposable

export type FetchHandler = {
	fetch: (request: Request) => Response | Promise<Response>
}

/**
 * The parts of an HTTP/1 or HTTP/2 compatibility request the bridge reads.
 */
type NodeRequest = {
	url?: string
	method?: string
	headers: http.IncomingHttpHeaders
	on(event: 'data', listener: (chunk: Uint8Array) => void): unknown
	on(event: 'end', listener: () => void): unknown
	on(event: 'error', listener: (error: Error) => void): unknown
	destroy(): void
}

/**
 * The parts of an HTTP/1 or HTTP/2 compatibility response the bridge writes.
 *
 * `flushHeaders` exists on the HTTP/2 compatibility object at runtime but is
 * not declared by its types, so it is optional here.
 */
type NodeResponse = {
	req: { method?: string }
	headersSent: boolean
	statusCode: number
	destroyed: boolean
	writableEnded: boolean
	writeHead(statusCode: number, headers?: http.OutgoingHttpHeaders): unknown
	setHeader(name: string, value: string): void
	flushHeaders?(): void
	write(chunk: Uint8Array): boolean
	end(callback?: () => void): unknown
	end(chunk: string | Uint8Array, callback?: () => void): unknown
	once(event: 'close', listener: () => void): unknown
	on(event: 'drain' | 'close', listener: () => void): unknown
	off(event: 'drain' | 'close', listener: () => void): unknown
	destroy(): void
}

/**
 * A request listener for an `http2` compatibility server.
 */
export type Http2RequestListener = (
	req: Http2ServerRequest,
	res: Http2ServerResponse,
) => void

// The structural contract above is intentionally smaller than the Node types.
// These aliases fail the build if either server implementation stops satisfying
// it, so the manual types cannot silently drift from what the bridge uses.
type AssertAssignable<Base, T extends Base> = T

type _HttpRequest = AssertAssignable<NodeRequest, http.IncomingMessage>
type _HttpResponse = AssertAssignable<NodeResponse, http.ServerResponse>
type _Http2Request = AssertAssignable<NodeRequest, Http2ServerRequest>
type _Http2Response = AssertAssignable<NodeResponse, Http2ServerResponse>

function isFetchHandler(value: unknown): value is FetchHandler {
	return (
		typeof value === 'object' &&
		value !== null &&
		'fetch' in value &&
		typeof value.fetch === 'function'
	)
}

async function loadHandler(entry: string) {
	const mod: unknown = await import(pathToFileURL(entry).href)
	const handler =
		typeof mod === 'object' && mod !== null && 'default' in mod ? mod.default : undefined

	if (!isFetchHandler(handler)) {
		throw new Error(`[solas] ${entry} does not export a fetch handler`)
	}

	return handler
}

/**
 * Adapt a Node readable stream (an incoming request body) to a web
 * `ReadableStream` for the fetch `Request`.
 */
function nodeToWeb(req: NodeRequest) {
	return new ReadableStream<Uint8Array>({
		start(controller) {
			req.on('data', chunk => controller.enqueue(chunk))
			req.on('end', () => controller.close())
			req.on('error', err => controller.error(err))
		},
		cancel() {
			req.destroy()
		},
	})
}

/**
 * Adapt a web `ReadableStream` (a response body) to a Node writable, applying
 * backpressure so large responses are not buffered in memory.
 */
async function webToNode<T extends Uint8Array>(
	stream: ReadableStream<T>,
	res: NodeResponse,
) {
	const reader = stream.getReader()
	let closed = false

	// a client that goes away leaves nothing to write to; cancel the source so
	// its producer stops instead of buffering into a dead socket
	function onClose() {
		closed = true
		void reader.cancel().catch(() => {})
	}

	res.once('close', onClose)

	try {
		while (true) {
			if (closed) break

			const { done, value } = await reader.read()
			if (done) break
			if (closed || res.destroyed || res.writableEnded) break

			try {
				// `write` returns false when the socket buffer is full. That is not an
				// error: wait for the `'drain'` event before writing more, otherwise a
				// fast producer and a slow client would buffer the whole body in memory
				if (!res.write(value)) {
					await new Promise<void>(resolve => {
						function settle() {
							res.off('drain', settle)
							res.off('close', settle)
							resolve()
						}

						res.on('drain', settle)
						res.on('close', settle)
					})
				}
			} catch {
				// the socket died between the checks above
				break
			}
		}
	} finally {
		res.off('close', onClose)

		try {
			reader.releaseLock()
		} catch {
			// a pending read can outlive a cancel by a tick
		}
	}
}

/**
 * Convert a Node request into a fetch `Request`, streaming the body when present.
 */
function toRequest(req: NodeRequest, signal?: AbortSignal): Request {
	// HTTP/2's compatibility API also exposes pseudo-headers such as `:path` and
	// `:authority`. Fetch `Headers` rejects names starting with `:`, and the
	// authority replaces the HTTP/1 `host` header, so normalise both here
	const authority = req.headers[':authority']
	const host = req.headers.host ?? (Array.isArray(authority) ? authority[0] : authority)
	const url = new URL(req.url ?? '/', `http://${host ?? 'localhost'}`)
	const headers = new Headers()

	for (const [key, value] of Object.entries(req.headers)) {
		if (key.startsWith(':')) continue

		if (Array.isArray(value)) {
			for (const item of value) headers.append(key, item)
		} else if (value !== undefined) {
			headers.set(key, value)
		}
	}

	const method = req.method ?? 'GET'
	const hasBody = method !== 'GET' && method !== 'HEAD'

	// a streaming request body requires `duplex` when a body is included
	const init: RequestInit & { duplex: 'half' } = {
		method,
		headers,
		body: hasBody ? nodeToWeb(req) : undefined,
		duplex: 'half',
		signal,
	}

	return new Request(url, init)
}

/**
 * Write a fetch `Response` back to the Node response, streaming the body.
 */
async function sendResponse(res: NodeResponse, response: Response) {
	const headers: Record<string, string | string[]> = {}

	response.headers.forEach((value, key) => {
		if (key !== 'set-cookie') headers[key] = value
	})

	// Set-Cookie can repeat and contains commas, so the loop above would fold it
	// into one invalid header; getSetCookie returns each value, set as an array
	const cookies = response.headers.getSetCookie()
	if (cookies.length > 0) headers['set-cookie'] = cookies

	res.writeHead(response.status, headers)

	if (!response.body || res.req.method === 'HEAD') {
		res.end()
		return
	}

	// send headers now so a delayed first chunk (SSE, slow streams) does not
	// leave the client waiting with no response
	res.flushHeaders?.()

	await webToNode(response.body, res)
	if (!res.destroyed) res.end()
}

/**
 * Handle one Node request by forwarding it to the fetch handler.
 */
async function handleRequest(req: NodeRequest, res: NodeResponse, handler: FetchHandler) {
	const abort = new AbortController()

	// `close` before the response has finished means the client went away;
	// surface that through `req.signal` so long-lived work can stop
	function onClose() {
		if (!res.writableEnded) abort.abort(new Error('client disconnected'))
	}

	res.once('close', onClose)

	try {
		const response = await handler.fetch(toRequest(req, abort.signal))

		await sendResponse(res, response)
	} catch (err) {
		console.error('[solas] request failed', err)

		if (res.headersSent) {
			res.destroy()
			return
		}

		res.statusCode = 500
		res.setHeader('content-type', 'text/plain; charset=utf-8')
		res.end('Internal Server Error')
	} finally {
		res.off('close', onClose)
	}
}

/**
 * Create a request listener for a built fetch handler on an `http` or `https`
 * server.
 *
 * `serve` uses this internally. Exporting it lets you terminate TLS yourself:
 *
 * ```ts
 * import { createServer } from 'node:https'
 * import { createHttpRequestListener } from '@jk2908/solas/runtime/node'
 * import handler from './dist/rsc/index.js'
 *
 * createServer({ key, cert }, createHttpRequestListener(handler)).listen(443)
 * ```
 */
function createHttpRequestListener(handler: FetchHandler): http.RequestListener {
	return (req, res) => {
		void handleRequest(req, res, handler)
	}
}

/**
 * Create a request listener for a built fetch handler on an `http2`
 * compatibility server.
 *
 * Browsers only negotiate HTTP/2 over TLS, so use
 * `http2.createSecureServer({ allowHTTP1: true }, listener)`. `allowHTTP1`
 * keeps clients that do not speak HTTP/2 working:
 *
 * ```ts
 * import http2 from 'node:http2'
 * import { createHttp2RequestListener } from '@jk2908/solas/runtime/node'
 * import handler from './dist/rsc/index.js'
 *
 * http2.createSecureServer(
 * 	{ key, cert, allowHTTP1: true },
 * 	createHttp2RequestListener(handler),
 * ).listen(443)
 * ```
 */
function createHttp2RequestListener(handler: FetchHandler): Http2RequestListener {
	return (req, res) => {
		void handleRequest(req, res, handler)
	}
}

/**
 * Start a production HTTP server for a Node (or Bun) deployment.
 *
 * Loads the built RSC entry (`dist/rsc/index.js` by default) and forwards
 * requests to its fetch handler, which already serves prerendered routes,
 * client assets, and RSC/SSR responses. Run it from the project root so the
 * handler can resolve `dist`. The returned server is `AsyncDisposable`, so it
 * can be released with `await using`.
 *
 * For TLS or HTTP/2, mount `createHttpRequestListener(handler)` or
 * `createHttp2RequestListener(handler)` on your own server instead. Deno and Bun
 * do not need this helper: use `Deno.serve(handler.fetch)` or
 * `Bun.serve({ fetch: handler.fetch })` directly.
 */
async function serve(options: ServeOptions = {}) {
	const outDir = options.outDir ?? 'dist'
	const entry = path.resolve(options.entry ?? path.join(outDir, 'rsc', 'index.js'))
	const port = options.port ?? (Number(process.env.PORT) || 3000)
	const host = options.host ?? '0.0.0.0'

	const handler = await loadHandler(entry)
	const server = http.createServer(createHttpRequestListener(handler))

	await new Promise<void>(resolve => server.listen(port, host, resolve))
	options.onListen?.({ port, host })

	return Object.assign(server, {
		async [Symbol.asyncDispose]() {
			await new Promise<void>((resolve, reject) => {
				server.close(err => (err ? reject(err) : resolve()))
			})
		},
	})
}

export { createHttp2RequestListener, createHttpRequestListener, serve }
