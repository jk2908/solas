import { describe, expect, it } from 'vitest'

import { createInvalidationMatcher } from '../../../../src/internal/browser-router/invalidation-pattern.js'

describe('createInvalidationMatcher', () => {
	it('matches literal pages and layout descendants', () => {
		expect(createInvalidationMatcher('/posts', 'page')('/posts')).toBe(true)
		expect(createInvalidationMatcher('/posts', 'page')('/posts/one')).toBe(false)
		expect(createInvalidationMatcher('/posts', 'layout')('/posts/one')).toBe(true)
	})

	it('matches dynamic route patterns', () => {
		const page = createInvalidationMatcher('/posts/[slug]', 'page')
		const layout = createInvalidationMatcher('/posts/[slug]', 'layout')

		expect(page('/posts/one')).toBe(true)
		expect(page('/posts/one/edit')).toBe(false)
		expect(layout('/posts/one/edit')).toBe(true)
		expect(page('/posts')).toBe(false)
	})

	it('supports colon params and route groups', () => {
		expect(createInvalidationMatcher('/posts/:slug', 'page')('/posts/one')).toBe(true)
		expect(createInvalidationMatcher('/(app)/posts/[slug]', 'page')('/posts/one')).toBe(
			true,
		)
	})

	it('matches catch-all routes', () => {
		expect(createInvalidationMatcher('/docs/[...slug]', 'page')('/docs/a/b')).toBe(true)
	})

	it('matches all paths for the root layout', () => {
		expect(createInvalidationMatcher('/', 'layout')('/posts/one')).toBe(true)
	})
})
