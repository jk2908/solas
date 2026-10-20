import { describe, expect, it } from 'vitest'

import { RequestContext } from '../../../../src/internal/env/request-context.js'
import { nonce } from '../../../../src/server.js'

describe('nonce', () => {
	it('returns the nonce from the request context', () => {
		const req = new Request('http://localhost/')

		const value = RequestContext.write(
			{ req: req as never, prerender: null, cache: {}, nonce: 'abc123' },
			() => nonce(),
		)

		expect(value).toBe('abc123')
	})

	it('returns undefined when no nonce is configured', () => {
		const req = new Request('http://localhost/')

		const value = RequestContext.write(
			{ req: req as never, prerender: null, cache: {} },
			() => nonce(),
		)

		expect(value).toBeUndefined()
	})
})
