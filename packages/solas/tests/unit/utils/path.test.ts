import { describe, expect, it } from 'vitest'

import { isPathWithin, trimTrailingSlash } from '../../../src/utils/path.js'

describe('path helpers', () => {
	it('trims trailing slashes without changing root', () => {
		expect(trimTrailingSlash('/posts///')).toBe('/posts')
		expect(trimTrailingSlash('/')).toBe('/')
	})

	it('checks path containment', () => {
		expect(isPathWithin('/posts/one', '/posts')).toBe(true)
		expect(isPathWithin('/posts', '/posts')).toBe(true)
		expect(isPathWithin('/postscript', '/posts')).toBe(false)
		expect(isPathWithin('/anything', '/')).toBe(true)
	})
})
