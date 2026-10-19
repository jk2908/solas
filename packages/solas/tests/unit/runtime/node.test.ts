import { mkdtemp, writeFile } from 'node:fs/promises'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

import { describe, it, expect, afterEach } from 'vitest'

import { serve } from '../../../src/runtime/node.js'

async function writeEntry(source: string) {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'solas-node-'))
	const entry = path.join(dir, 'entry.mjs')
	await writeFile(entry, source)
	return entry
}

function getPort(server: http.Server) {
	const address = server.address()

	if (typeof address !== 'object' || address === null) {
		throw new Error('server has no address')
	}

	return address.port
}

async function waitFor(predicate: () => boolean, timeout = 2000) {
	const started = Date.now()

	while (!predicate()) {
		if (Date.now() - started > timeout) {
			throw new Error('timed out waiting for condition')
		}

		await new Promise(resolve => setTimeout(resolve, 10))
	}
}

function readFirstChunkThenDisconnect(port: number) {
	return new Promise<void>((resolve, reject) => {
		const req = http.get({ host: '127.0.0.1', port, path: '/' }, res => {
			res.once('data', () => {
				req.destroy()
				resolve()
			})
		})

		// destroying the request surfaces an error on the client side
		req.on('error', () => {})

		req.setTimeout(2000, () => {
			req.destroy()
			reject(new Error('timed out waiting for the first chunk'))
		})
	})
}

describe('serve', () => {
	let server: http.Server | undefined

	afterEach(async () => {
		delete (globalThis as Record<string, unknown>).__solasAborted
		delete (globalThis as Record<string, unknown>).__solasCancelled

		if (!server) return
		await new Promise<void>(resolve => server!.close(() => resolve()))
		server = undefined
	})

	it('forwards requests to the built handler', async () => {
		const entry = await writeEntry(
			`export default { fetch(request) { return new Response('ok:' + new URL(request.url).pathname) } }`,
		)

		server = await serve({ entry, port: 0, host: '127.0.0.1' })
		const port = getPort(server)

		const res = await fetch(`http://127.0.0.1:${port}/hello`)
		expect(await res.text()).toBe('ok:/hello')
	})

	it('streams the request body to the handler', async () => {
		const entry = await writeEntry(
			`export default { async fetch(request) { return new Response(await request.text()) } }`,
		)

		server = await serve({ entry, port: 0, host: '127.0.0.1' })
		const port = getPort(server)

		const res = await fetch(`http://127.0.0.1:${port}/`, {
			method: 'POST',
			body: 'hello body',
		})
		expect(await res.text()).toBe('hello body')
	})

	it('throws when the entry does not export a fetch handler', async () => {
		const entry = await writeEntry(`export default {}`)

		await expect(serve({ entry, port: 0 })).rejects.toThrow(/fetch handler/)
	})

	it('aborts the request signal when the client disconnects', async () => {
		const entry = await writeEntry(`
			export default {
				fetch(req) {
					globalThis.__solasAborted = false
					return new Response(
						new ReadableStream({
							start(controller) {
								controller.enqueue(new TextEncoder().encode('data: ready\\n\\n'))
								req.signal.addEventListener('abort', () => {
									globalThis.__solasAborted = true
									try { controller.close() } catch {}
								})
							},
						}),
						{ headers: { 'Content-Type': 'text/event-stream' } },
					)
				},
			}
		`)

		server = await serve({ entry, port: 0, host: '127.0.0.1' })
		const port = getPort(server)

		await readFirstChunkThenDisconnect(port)
		await waitFor(() => (globalThis as Record<string, unknown>).__solasAborted === true)

		expect((globalThis as Record<string, unknown>).__solasAborted).toBe(true)
	})

	it('cancels the response stream when the client disconnects', async () => {
		const entry = await writeEntry(`
			export default {
				fetch() {
					globalThis.__solasCancelled = false
					return new Response(
						new ReadableStream({
							start(controller) {
								controller.enqueue(new TextEncoder().encode('data: ready\\n\\n'))
							},
							cancel() {
								globalThis.__solasCancelled = true
							},
						}),
						{ headers: { 'Content-Type': 'text/event-stream' } },
					)
				},
			}
		`)

		server = await serve({ entry, port: 0, host: '127.0.0.1' })
		const port = getPort(server)

		await readFirstChunkThenDisconnect(port)
		await waitFor(() => (globalThis as Record<string, unknown>).__solasCancelled === true)

		expect((globalThis as Record<string, unknown>).__solasCancelled).toBe(true)
	})

	it('flushes response headers before the first body chunk', async () => {
		const entry = await writeEntry(`
			export default {
				fetch() {
					const encoder = new TextEncoder()
					return new Response(
						new ReadableStream({
							start(controller) {
								setTimeout(() => {
									controller.enqueue(encoder.encode('data: later\\n\\n'))
									controller.close()
								}, 200)
							},
						}),
						{ headers: { 'Content-Type': 'text/event-stream' } },
					)
				},
			}
		`)

		server = await serve({ entry, port: 0, host: '127.0.0.1' })
		const port = getPort(server)

		const firstChunk = await new Promise<string>((resolve, reject) => {
			const socket = net.connect(port, '127.0.0.1', () => {
				socket.write(
					'GET / HTTP/1.1\r\nHost: localhost\r\nAccept: text/event-stream\r\nConnection: close\r\n\r\n',
				)
			})

			socket.once('data', chunk => {
				resolve(chunk.toString())
				socket.destroy()
			})

			socket.once('error', reject)

			socket.setTimeout(2000, () => {
				socket.destroy()
				reject(new Error('timed out waiting for headers'))
			})
		})

		// the headers must arrive on their own, before the delayed body
		expect(firstChunk).toContain('\r\n\r\n')
		expect(firstChunk).not.toContain('data:')
	})
})
