import { describe, expect, it } from 'vitest'

import {
	layoutCacheKey,
	layoutSegmentKey,
} from '../../../../src/internal/browser-router/layout-cache-key.js'

const layoutSegments = {
	layouts: ['$S:shell', '$L:users/+layout'],
	page: '$P:users/+page',
}

describe('layoutCacheKey', () => {
	it('reuses a layout chain across pages with the same params', () => {
		const first = layoutCacheKey(layoutSegments, { id: '1' })
		const second = layoutCacheKey(
			{ ...layoutSegments, page: '$P:users/settings/+page' },
			{ id: '1' },
		)

		expect(first).toBe(second)
	})

	it('sorts params before building the key', () => {
		expect(layoutCacheKey(layoutSegments, { id: '1', lang: 'en' })).toBe(
			layoutCacheKey(layoutSegments, { lang: 'en', id: '1' }),
		)
	})

	it('separates layout chains with different params', () => {
		expect(layoutCacheKey(layoutSegments, { id: '1' })).not.toBe(
			layoutCacheKey(layoutSegments, { id: '2' }),
		)
	})

	it('separates different layout chains', () => {
		expect(layoutCacheKey(layoutSegments, { id: '1' })).not.toBe(
			layoutCacheKey(
				{ ...layoutSegments, layouts: ['$S:shell', '$L:admin/+layout'] },
				{ id: '1' },
			),
		)
	})

	it('ignores empty layout slots', () => {
		expect(
			layoutCacheKey(
				{ ...layoutSegments, layouts: ['$S:shell', '$L:users/+layout', null] },
				{},
			),
		).toBe(layoutCacheKey(layoutSegments, {}))
	})
})

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
