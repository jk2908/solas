import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../../src/internal/env/request-context.js', () => ({
	RequestContext: {
		use: vi.fn(),
	},
}))

import { mockRequestContext } from '../../../utils.js'

const { RequestContext } = await import('../../../../src/internal/env/request-context.js')
const { dynamic } = await import('../../../../src/internal/server/dynamic.js')

function setupContext(prerender: null | 'full' | 'ppr') {
	const ctx = mockRequestContext(new Request('http://localhost'), {}, prerender)
	vi.mocked(RequestContext.use).mockReturnValue(ctx)
}

describe('dynamic', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('resolves immediately when prerender is null', async () => {
		setupContext(null)
		await expect(dynamic()).resolves.toBeUndefined()
	})

	it('resolves immediately when prerender is "full"', async () => {
		setupContext('full')
		await expect(dynamic()).resolves.toBeUndefined()
	})

	it('hangs forever when prerender is "ppr"', async () => {
		setupContext('ppr')
		const result = await Promise.race([
			dynamic(),
			new Promise<'timed out'>(r => setTimeout(() => r('timed out'), 50)),
		])
		expect(result).toBe('timed out')
	})
})
