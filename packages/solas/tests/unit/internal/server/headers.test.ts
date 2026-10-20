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
const { headers } = await import('../../../../src/internal/server/headers.js')

function setupContext(req: Request, cache: RequestCache = {}) {
	vi.mocked(dynamic).mockResolvedValue(undefined)
	const ctx = mockRequestContext(req, cache)
	vi.mocked(RequestContext.use).mockReturnValue(ctx)
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
})
