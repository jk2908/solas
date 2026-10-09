import { once } from 'node:events'
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

type FetchHandler = {
	fetch: (request: Request) => Response | Promise<Response>
}

function isFetchHandler(value: unknown): value is FetchHandler {
	return (
		typeof value === 'object' &&
		value !== null &&
		'fetch' in value &&
		typeof value.fetch === 'function'
	)
}

async function loadHandler(entry: string): Promise<FetchHandler> {
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
function nodeToWeb(req: http.IncomingMessage) {
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
	res: http.ServerResponse,
) {
	const reader = stream.getReader()

	try {
		while (true) {
			const { done, value } = await reader.read()
			if (done) break

			// `write` returns false when the socket buffer is full. That is not an
			// error: wait for the `'drain'` event before writing more, otherwise a
			// fast producer and a slow client would buffer the whole body in memory
			if (!res.write(value)) await once(res, 'drain')
		}
	} finally {
		reader.releaseLock()
	}
}

/**
 * Convert a Node request into a fetch `Request`, streaming the body when present.
 */
function toRequest(req: http.IncomingMessage): Request {
	const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
	const headers = new Headers()

	for (const [key, value] of Object.entries(req.headers)) {
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
	}

	return new Request(url, init)
}

/**
 * Write a fetch `Response` back to the Node response, streaming the body.
 */
async function sendResponse(res: http.ServerResponse, response: Response) {
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

	await webToNode(response.body, res)
	res.end()
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
 * Deno and Bun do not need this helper: use `Deno.serve(handler.fetch)` or
 * `Bun.serve({ fetch: handler.fetch })` directly.
 */
export async function serve(options: ServeOptions = {}) {
	const outDir = options.outDir ?? 'dist'
	const entry = path.resolve(options.entry ?? path.join(outDir, 'rsc', 'index.js'))
	const port = options.port ?? (Number(process.env.PORT) || 3000)
	const host = options.host ?? '0.0.0.0'

	const handler = await loadHandler(entry)

	const server = http.createServer(async (req, res) => {
		try {
			const response = await handler.fetch(toRequest(req))
			await sendResponse(res, response)
		} catch (err) {
			console.error('[solas] request failed', err)
			res.statusCode = 500
			res.setHeader('content-type', 'text/plain; charset=utf-8')
			res.end('Internal Server Error')
		}
	})

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
