import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockCreateRuntimeHandler } = vi.hoisted(() => ({
	mockCreateRuntimeHandler: vi.fn(async () => ({
		fetch: vi.fn(async () => new Response('ok')),
	})),
}))

vi.mock('../../../../src/internal/env/rsc.js', () => ({
	createRuntimeHandler: mockCreateRuntimeHandler,
}))

import { createWorker } from '../../../../src/adapters/cloudflare/worker.js'

const init = { config: {}, manifest: {}, importMap: {} } as never

function env() {
	return { ASSETS: { fetch: async () => new Response('asset') } }
}

beforeEach(() => {
	mockCreateRuntimeHandler.mockClear()
})

describe('createWorker', () => {
	it('builds and caches a handler per env', async () => {
		const worker = createWorker(init)
		const a = env()
		const b = env()

		await worker.fetch(new Request('https://example.com/'), a)
		await worker.fetch(new Request('https://example.com/'), a)
		expect(mockCreateRuntimeHandler).toHaveBeenCalledTimes(1)

		await worker.fetch(new Request('https://example.com/'), b)
		expect(mockCreateRuntimeHandler).toHaveBeenCalledTimes(2)
	})

	it('evicts a rejected handler so a transient failure does not poison the isolate', async () => {
		mockCreateRuntimeHandler.mockRejectedValueOnce(new Error('boom'))
		const worker = createWorker(init)
		const a = env()

		await expect(worker.fetch(new Request('https://example.com/'), a)).rejects.toThrow(
			'boom',
		)

		const res = await worker.fetch(new Request('https://example.com/'), a)
		expect(res).toBeInstanceOf(Response)
		expect(mockCreateRuntimeHandler).toHaveBeenCalledTimes(2)
	})

	it('uses the node asset store when invoked without bindings (build-time prerender)', async () => {
		const worker = createWorker(init)

		const res = await worker.fetch(new Request('https://example.com/'))
		expect(res).toBeInstanceOf(Response)
		expect(mockCreateRuntimeHandler).toHaveBeenCalledTimes(1)
	})
})
