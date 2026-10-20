import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../../src/internal/server/dynamic.js', () => ({
	dynamic: vi.fn(),
}))

vi.mock('../../../../src/internal/env/request-context.js', () => ({
	RequestContext: {
		use: vi.fn(),
	},
}))

import type { RequestCache } from '../../../../src/internal/env/request-context.js'
import { mockRequestContext } from '../../../utils.js'

const { dynamic } = await import('../../../../src/internal/server/dynamic.js')
const { RequestContext } = await import('../../../../src/internal/env/request-context.js')
const { createHeaderResolver, headers } =
	await import('../../../../src/internal/server/headers.js')

function setupContext(req: Request, cache: RequestCache = {}, nonce?: string) {
	vi.mocked(dynamic).mockResolvedValue(undefined)
	const ctx = mockRequestContext(req, cache)
	vi.mocked(RequestContext.use).mockReturnValue({ ...ctx, nonce })
}

describe('headers', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('returns headers from request context', async () => {
		const req = new Request('http://localhost', {
			headers: { 'content-type': 'text/html', 'x-custom': 'val' },
		})
		setupContext(req)

		const result = await headers()
		expect(result.get('content-type')).toBe('text/html')
		expect(result.get('x-custom')).toBe('val')
		expect(result.size).toBe(2)
	})

	it('returns cached headers on subsequent calls', async () => {
		const cache: RequestCache = {}
		setupContext(
			new Request('http://localhost', {
				headers: { 'content-type': 'text/html' },
			}),
			cache,
		)

		const first = await headers()
		const second = await headers()
		expect(first).toBe(second)
	})

	it('returns read-only map', async () => {
		const req = new Request('http://localhost', {
			headers: { 'content-type': 'text/html' },
		})
		setupContext(req)

		const result = await headers()
		expect(result).toBeInstanceOf(Map)
	})

	it('calls dynamic before reading headers', async () => {
		setupContext(new Request('http://localhost'))

		await headers()
		expect(dynamic).toHaveBeenCalledOnce()
	})

	it('exposes the effective nonce as x-nonce', async () => {
		setupContext(new Request('http://localhost'), {}, 'abc123')

		expect((await headers()).get('x-nonce')).toBe('abc123')
	})

	it('removes a stale x-nonce when there is no effective nonce', async () => {
		setupContext(
			new Request('http://localhost', {
				headers: { 'x-nonce': 'stale' },
			}),
		)

		expect((await headers()).has('x-nonce')).toBe(false)
	})
})

describe('createHeaderResolver', () => {
	it('returns an empty object when no headers are configured', async () => {
		const resolve = createHeaderResolver(undefined)

		expect(await resolve(new Request('http://localhost/'))).toEqual({})
	})

	it('returns the configured object', async () => {
		const configured = { 'x-test': '1' }
		const resolve = createHeaderResolver(configured)

		expect(await resolve(new Request('http://localhost/'))).toBe(configured)
	})

	it('evaluates a function once per request', async () => {
		const configured = vi.fn(() => ({ 'x-test': '1' }))
		const resolve = createHeaderResolver(configured)
		const req = new Request('http://localhost/')

		const [first, second] = await Promise.all([resolve(req), resolve(req)])

		expect(first).toBe(second)
		expect(configured).toHaveBeenCalledOnce()
	})

	it('evaluates a function separately for different requests', async () => {
		const configured = vi.fn((req: Request) => ({ 'x-url': req.url }))
		const resolve = createHeaderResolver(configured)

		const first = await resolve(new Request('http://localhost/a'))
		const second = await resolve(new Request('http://localhost/b'))

		expect(first['x-url']).toContain('/a')
		expect(second['x-url']).toContain('/b')
		expect(configured).toHaveBeenCalledTimes(2)
	})

	it('turns a synchronous throw into a rejection', async () => {
		const resolve = createHeaderResolver(() => {
			throw new Error('boom')
		})

		await expect(resolve(new Request('http://localhost/'))).rejects.toThrow('boom')
	})
})
