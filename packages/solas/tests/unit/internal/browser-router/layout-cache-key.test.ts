import { describe, expect, it } from 'vitest'

import { layoutSegmentKey } from '../../../../src/internal/browser-router/layout-cache-key.js'

describe('layoutSegmentKey', () => {
	it('keys one layout node by id and params', () => {
		expect(layoutSegmentKey('$L:users/+layout', { id: '1' })).toBe(
			layoutSegmentKey('$L:users/+layout', { id: '1' }),
		)
		expect(layoutSegmentKey('$L:users/+layout', { id: '1' })).not.toBe(
			layoutSegmentKey('$L:users/+layout', { id: '2' }),
		)
	})

	it('allows different layout nodes to share params', () => {
		expect(layoutSegmentKey('$S:shell', { id: '1' })).not.toBe(
			layoutSegmentKey('$L:users/+layout', { id: '1' }),
		)
	})
})
