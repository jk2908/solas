import { describe, expect, it } from 'vitest'

import { LayoutCache } from '../../../../src/internal/browser-router/layout-cache.js'

describe('LayoutCache', () => {
	it('keys nodes by id and params', () => {
		const cache = new LayoutCache()
		cache.set('layout', { id: '1' }, 'one', {
			expiresAt: Number.POSITIVE_INFINITY,
		})

		expect(cache.get('layout', { id: '1' })?.value).toBe('one')
		expect(cache.get('layout', { id: '2' })).toBeUndefined()
	})

	it('reports missing nodes', () => {
		const cache = new LayoutCache()
		cache.set('a', undefined, 'a', {
			expiresAt: Number.POSITIVE_INFINITY,
		})

		expect(cache.getValues(['a', 'b'], undefined)).toMatchObject({
			missing: true,
		})
	})

	it('drops expired nodes when listing ids', () => {
		const cache = new LayoutCache()
		cache.set('old', undefined, 'old', { expiresAt: 0 })
		cache.set('live', undefined, 'live', {
			expiresAt: Number.POSITIVE_INFINITY,
		})

		expect(cache.ids()).toEqual(['live'])
	})

	it('invalidates layout descendants', () => {
		const cache = new LayoutCache()
		cache.set('a', undefined, 'a', {
			expiresAt: Number.POSITIVE_INFINITY,
			path: '/about/another',
		})
		cache.set('b', undefined, 'b', {
			expiresAt: Number.POSITIVE_INFINITY,
			path: '/other',
		})

		cache.invalidatePath('/about', 'layout')

		expect(cache.get('a')).toBeUndefined()
		expect(cache.get('b')?.value).toBe('b')
	})

	it('keeps layouts for page-scoped invalidation', () => {
		const cache = new LayoutCache()
		cache.set('a', undefined, 'a', {
			expiresAt: Number.POSITIVE_INFINITY,
			path: '/about',
		})

		cache.invalidatePath('/about', 'page')

		expect(cache.get('a')?.value).toBe('a')
	})
})
