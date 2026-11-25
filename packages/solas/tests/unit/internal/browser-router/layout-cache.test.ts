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

	it('invalidates layouts reused by another path', () => {
		const cache = new LayoutCache()
		cache.set('a', undefined, 'a', {
			expiresAt: Number.POSITIVE_INFINITY,
			path: '/about',
		})
		cache.touch('a', undefined, '/team')

		cache.invalidatePath('/team', 'layout')

		expect(cache.get('a')).toBeUndefined()
	})

	it('records paths when reading cached nodes', () => {
		const cache = new LayoutCache()
		cache.set('a', undefined, 'a', {
			expiresAt: Number.POSITIVE_INFINITY,
			path: '/about',
		})

		cache.getValues(['a'], undefined, '/team')
		cache.invalidatePath('/team', 'layout')

		expect(cache.get('a')).toBeUndefined()
	})

	it('evicts the least recently used layout', () => {
		const cache = new LayoutCache({ maxEntries: 2 })
		cache.set('a', undefined, 'a', { expiresAt: Number.POSITIVE_INFINITY })
		cache.set('b', undefined, 'b', { expiresAt: Number.POSITIVE_INFINITY })
		cache.get('a')
		cache.set('c', undefined, 'c', { expiresAt: Number.POSITIVE_INFINITY })

		expect(cache.get('a')?.value).toBe('a')
		expect(cache.get('b')).toBeUndefined()
		expect(cache.get('c')?.value).toBe('c')
	})

	it('invalidates descendant layouts from the root', () => {
		const cache = new LayoutCache()
		cache.set('a', undefined, 'a', {
			expiresAt: Number.POSITIVE_INFINITY,
			path: '/about',
		})

		cache.invalidatePath('/', 'layout')

		expect(cache.get('a')).toBeUndefined()
	})

	it('invalidates layouts from dynamic route patterns', () => {
		const cache = new LayoutCache()
		cache.set('a', undefined, 'a', {
			expiresAt: Number.POSITIVE_INFINITY,
			path: '/posts/one',
		})

		cache.invalidatePath('/posts/[slug]', 'layout')

		expect(cache.get('a')).toBeUndefined()
	})

	it('bounds entries for many parameter combinations', () => {
		const cache = new LayoutCache({ maxEntries: 50 })

		for (let index = 0; index < 200; index++) {
			cache.set(`layout-${index}`, { id: String(index) }, index, {
				expiresAt: Number.POSITIVE_INFINITY,
				path: `/posts/${index}`,
			})
		}

		expect(cache.ids()).toHaveLength(50)
		expect(cache.get('layout-0', { id: '0' })).toBeUndefined()
		expect(cache.get('layout-199', { id: '199' })?.value).toBe(199)
	})

	it('falls back to wildcard invalidation after many paths', () => {
		const cache = new LayoutCache()
		cache.set('shared', undefined, 'shared', {
			expiresAt: Number.POSITIVE_INFINITY,
			path: '/posts/0',
		})

		for (let index = 1; index < 40; index++) {
			cache.touch('shared', undefined, `/posts/${index}`)
		}

		cache.invalidatePath('/unrelated', 'layout')

		expect(cache.get('shared')).toBeUndefined()
	})

	it('invalidates many concrete paths through a dynamic pattern', () => {
		const cache = new LayoutCache()

		for (let index = 0; index < 100; index++) {
			cache.set(`layout-${index}`, undefined, index, {
				expiresAt: Number.POSITIVE_INFINITY,
				path: `/posts/${index}`,
			})
		}

		cache.invalidatePath('/posts/[slug]', 'layout')

		expect(cache.ids()).toEqual([])
	})

	it('does not store layouts when disabled', () => {
		const cache = new LayoutCache({ enabled: false })
		cache.set('a', undefined, 'a', {
			expiresAt: Number.POSITIVE_INFINITY,
		})

		expect(cache.get('a')).toBeUndefined()
		expect(cache.ids()).toEqual([])
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
