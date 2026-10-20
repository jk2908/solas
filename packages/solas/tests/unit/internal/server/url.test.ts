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
const { url } = await import('../../../../src/internal/server/url.js')

function setupContext(req: Request, cache: RequestCache = {}) {
	vi.mocked(dynamic).mockResolvedValue(undefined)
	const ctx = mockRequestContext(req, cache)
	vi.mocked(RequestContext.use).mockReturnValue(ctx)
}

describe('url', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('returns parsed URL from request', async () => {
		setupContext(new Request('http://localhost/path?q=1'))

		const result = await url()
		expect(result).toBeInstanceOf(URL)
		expect(result.pathname).toBe('/path')
		expect(result.searchParams.get('q')).toBe('1')
	})

	it('returns a clone each time', async () => {
		const cache: RequestCache = {}
		setupContext(new Request('http://localhost/path'), cache)

		const first = await url()
		const second = await url()
		expect(first).not.toBe(second)
		expect(first.href).toBe(second.href)
	})

	it('calls dynamic before parsing URL', async () => {
		setupContext(new Request('http://localhost/'))

		await url()
		expect(dynamic).toHaveBeenCalledOnce()
	})

	it('throws for invalid request url', async () => {
		const req = new Request('http://localhost')
		Object.defineProperty(req, 'url', { get: () => '::invalid::' })
		setupContext(req)

		await expect(url()).rejects.toThrow('Invalid request url')
	})
})
