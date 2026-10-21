import { describe, expect, it } from 'vitest'

import { isRecord, isStringArray } from '../../../src/utils/validation.js'

describe('validation', () => {
	it('recognises plain records', () => {
		expect(isRecord({})).toBe(true)
		expect(isRecord({ value: 1 })).toBe(true)
		expect(isRecord([])).toBe(false)
		expect(isRecord(null)).toBe(false)
	})

	it('recognises string arrays', () => {
		expect(isStringArray([])).toBe(true)
		expect(isStringArray(['self'])).toBe(true)
		expect(isStringArray(['self', 1])).toBe(false)
		expect(isStringArray('self')).toBe(false)
	})
})
