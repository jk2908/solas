import { describe, expect, it, vi } from 'vitest'

vi.mock('@vitejs/plugin-rsc/rsc', () => ({
	renderToReadableStream: vi.fn(),
}))

import type { RuntimeConfig } from '../../../../src/types.js'
import * as Config from '../../../../src/config.js'
import { createHandler } from '../../../../src/internal/env/rsc.js'
import { createSegment } from '../../../utils.js'

const config = {
	precompress: false,
	trailingSlash: 'never',
	trustedOrigins: [],
} as RuntimeConfig

describe('createHandler', () => {
	it('returns a bodyless prefetch response for routes that are not fully prerendered', async () => {
		const handler = createHandler(
			config,
			{ '/writing': createSegment('/writing', { prerender: 'ppr' }) },
			{ 'p_/writing': { middlewares: [] } },
		)

		const response = await handler.fetch(
			new Request('http://localhost/writing', {
				headers: { [`x-${Config.SLUG}-prefetch`]: '1' },
			}),
		)

		expect(response.status).toBe(204)
		expect(response.body).toBeNull()
	})
})
