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
const { cookies } = await import('../../../../src/internal/server/cookies.js')

function setupContext(req: Request, cache: RequestCache = {}) {
	vi.mocked(dynamic).mockResolvedValue(undefined)
	const ctx = mockRequestContext(req, cache)
	vi.mocked(RequestContext.use).mockReturnValue(ctx)
}

describe('cookies', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('parses cookies from request header', async () => {
		const req = new Request('http://localhost', {
			headers: { cookie: 'foo=bar; baz=qux' },
		})
		setupContext(req)

		const result = await cookies()
		expect(result.get('foo')).toBe('bar')
		expect(result.get('baz')).toBe('qux')
	})

	it('returns empty map when no cookie header', async () => {
		setupContext(new Request('http://localhost'))

		const result = await cookies()
		expect(result.size).toBe(0)
	})

	it('caches parsed cookies on subsequent calls', async () => {
		const cache: RequestCache = {}
		setupContext(new Request('http://localhost', { headers: { cookie: 'a=1' } }), cache)

		const first = await cookies()
		const second = await cookies()
		expect(first).toBe(second)
	})

	it('calls dynamic before parsing cookies', async () => {
		setupContext(new Request('http://localhost'))

		await cookies()
		expect(dynamic).toHaveBeenCalledOnce()
	})
})
