import type http from 'node:http'

import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describe, it, expect, afterEach } from 'vitest'

import { serve } from '../../../src/adapters/node.js'

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

describe('serve', () => {
	let server: http.Server | undefined

	afterEach(async () => {
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
})
