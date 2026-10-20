import { describe, it, expect } from 'vitest'

import { hash } from '../../../src/utils/hash.js'

describe('hash', () => {
	it('produces a deterministic 16-char hex hash', () => {
		const h1 = hash('hello')
		const h2 = hash('hello')
		const h3 = hash('world')

		expect(h1).toBe(h2)
		expect(h1).not.toBe(h3)
		expect(h1).toMatch(/^[0-9a-f]{16}$/)
	})
})
