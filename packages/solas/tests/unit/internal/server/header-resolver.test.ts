import { describe, expect, it, vi } from 'vitest'

import { createHeaderResolver } from '../../../../src/internal/server/header-resolver.js'

describe('createHeaderResolver', () => {
	it('returns an empty object when no headers are configured', async () => {
		const resolve = createHeaderResolver(undefined)

		expect(await resolve(new Request('http://localhost/'))).toEqual({})
	})

	it('returns the configured object', async () => {
		const headers = { 'x-test': '1' }
		const resolve = createHeaderResolver(headers)

		expect(await resolve(new Request('http://localhost/'))).toBe(headers)
	})

	it('evaluates a function once per request', async () => {
		const headers = vi.fn(() => ({ 'x-test': '1' }))
		const resolve = createHeaderResolver(headers)
		const req = new Request('http://localhost/')

		const [first, second] = await Promise.all([resolve(req), resolve(req)])

		expect(first).toBe(second)
		expect(headers).toHaveBeenCalledOnce()
	})

	it('evaluates a function separately for different requests', async () => {
		const headers = vi.fn((req: Request) => ({ 'x-url': req.url }))
		const resolve = createHeaderResolver(headers)

		const first = await resolve(new Request('http://localhost/a'))
		const second = await resolve(new Request('http://localhost/b'))

		expect(first['x-url']).toContain('/a')
		expect(second['x-url']).toContain('/b')
		expect(headers).toHaveBeenCalledTimes(2)
	})

	it('turns a synchronous throw into a rejection', async () => {
		const resolve = createHeaderResolver(() => {
			throw new Error('boom')
		})

		await expect(resolve(new Request('http://localhost/'))).rejects.toThrow('boom')
	})
})
