import { describe, it, expect } from 'vitest'

import { withBindingsShim } from '../../../../src/adapters/cloudflare/bindings.js'

describe('cloudflare bindings shim', () => {
	it('calls through to the wrapped import', async () => {
		const module = { default: { fetch: async () => new Response() } }
		const wrapped = withBindingsShim(async () => module)

		expect(await wrapped()).toBe(module)
	})
})
