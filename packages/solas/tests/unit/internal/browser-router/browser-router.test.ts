// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'

import { BrowserRouterHistory } from '../../../../src/internal/browser-router/history.js'
import {
	isExternalTarget,
	isHashOnlyTarget,
	toTarget,
	withBase,
} from '../../../../src/internal/browser-router/shared.js'

const defaultLocation = { pathname: '/', search: '', hash: '' }

function setScrollY(value: number) {
	Object.defineProperty(window, 'scrollY', {
		value,
		configurable: true,
		writable: true,
	})
}

function createHistory() {
	return new BrowserRouterHistory(defaultLocation)
}

function pushHistory(h: BrowserRouterHistory, ...paths: string[]) {
	for (const p of paths) {
		window.location.pathname = p
		h.pushState(p)
	}
}

describe('BrowserRouter', () => {
	describe('isHashOnlyTarget', () => {
		it('returns true for hash-only targets', () => {
			expect(isHashOnlyTarget('#section')).toBe(true)
		})

		it('returns false for non-hash targets', () => {
			expect(isHashOnlyTarget('/path')).toBe(false)
			expect(isHashOnlyTarget('https://example.com')).toBe(false)
		})
	})

	describe('isExternalTarget', () => {
		it('returns false for hash-only targets', () => {
			expect(isExternalTarget('#section', 'https://example.com')).toBe(false)
		})

		it('returns true for different origins', () => {
			expect(isExternalTarget('https://other.com', 'https://example.com')).toBe(true)
		})

		it('returns false for same origin', () => {
			expect(isExternalTarget('https://example.com/page', 'https://example.com')).toBe(
				false,
			)
		})

		it('returns false for relative paths', () => {
			expect(isExternalTarget('/about', 'https://example.com')).toBe(false)
		})

		it('handles malformed URLs gracefully', () => {
			expect(isExternalTarget('', 'https://example.com')).toBe(false)
		})
	})

	describe('toTarget', () => {
		it('replaces :param segments', () => {
			const result = toTarget('/posts/:id', { id: '123' })
			expect(result).toContain('/posts/123')
		})

		it('throws for missing params', () => {
			expect(() => toTarget('/posts/:id', {})).toThrow('missing route param')
		})

		it('handles wildcard routes', () => {
			const result = toTarget('/docs/*', { wildcard0: 'guide/getting-started' })
			expect(result).toContain('/docs/guide/getting-started')
		})

		it('throws when wildcard has no remaining param', () => {
			expect(() => toTarget('/docs/*', {})).toThrow('wildcard routes require')
		})

		it('appends query params', () => {
			const result = toTarget('/search', undefined, { q: 'test' })
			expect(result).toContain('?q=test')
		})

		it('preserves existing hash', () => {
			const result = toTarget('/page#section', undefined, { q: '1' })
			expect(result).toContain('section')
		})

		it('merges query with existing query string', () => {
			const result = toTarget('/search?existing=true', undefined, { extra: '1' })
			expect(result).toContain('existing=true')
			expect(result).toContain('extra=1')
		})

		it('encodes param values', () => {
			const result = toTarget('/path/:id', { id: 'a/b' })
			expect(result).toContain('a%2Fb')
		})
	})
})

describe('withBase', () => {
	it('passes through hash-only targets', () => {
		expect(withBase('#section')).toBe('#section')
	})

	it('passes through full URLs', () => {
		expect(withBase('https://example.com/path')).toBe('https://example.com/path')
	})

	it('passes through protocol-relative URLs', () => {
		expect(withBase('//other.com/path')).toBe('//other.com/path')
	})

	it('preserves query and hash suffixes', () => {
		const r = withBase('/path?q=1#hash')
		expect(r).toMatch(/\/path\?q=1/)
		expect(r).toMatch(/#hash/)
	})
})

describe('BrowserRouterHistory', () => {
	beforeEach(() => {
		window.location.pathname = '/'
	})

	it('initialises with a single entry', () => {
		const h = createHistory()
		expect(h.entries).toHaveLength(1)
		expect(h.index).toBe(0)
		expect(h.length).toBe(1)
		expect(h.current).toEqual({ ...defaultLocation, scrollY: 0 })
	})

	it('pushes new entries', () => {
		const h = createHistory()
		pushHistory(h, '/about')
		expect(h.length).toBe(2)
		expect(h.index).toBe(1)
	})

	it('replaceState updates current entry', () => {
		const h = createHistory()
		window.location.pathname = '/home'
		h.replaceState('/home')
		expect(h.length).toBe(1)
		expect(h.index).toBe(0)
	})

	it('go(0) returns current without changing index', () => {
		const h = createHistory()
		pushHistory(h, '/a', '/b')
		expect(h.go(0)).toEqual(h.current)
		expect(h.index).toBe(2)
	})

	it('go(-1) goes back', () => {
		const h = createHistory()
		pushHistory(h, '/a', '/b')
		const entry = h.go(-1)
		expect(h.index).toBe(1)
		expect(entry!.pathname).toBe('/a')
	})

	it('go(1) goes forward', () => {
		const h = createHistory()
		pushHistory(h, '/a', '/b')
		h.go(-1)
		const entry = h.go(1)
		expect(h.index).toBe(2)
		expect(entry!.pathname).toBe('/b')
	})

	it('go clamps to valid range', () => {
		const h = createHistory()
		expect(h.go(-100)?.pathname).toBe('/')
		expect(h.index).toBe(0)
	})

	it('pushState drops forward entries when not at end', () => {
		const h = createHistory()
		pushHistory(h, '/a', '/b', '/c')
		h.go(-2)
		window.location.pathname = '/new'
		h.pushState('/new')
		expect(h.entries.map(e => e.pathname)).toEqual(['/', '/a', '/new'])
		expect(h.index).toBe(2)
	})

	it('entries returns a copy', () => {
		const h = createHistory()
		const entries = h.entries
		entries.push({ pathname: '', search: '', hash: '', scrollY: 0 })
		expect(h.entries).toHaveLength(1)
	})

	it('saves the outgoing scroll position on push and resets the new entry', () => {
		const h = createHistory()
		setScrollY(120)

		pushHistory(h, '/a')

		expect(h.entries[0]?.scrollY).toBe(120)
		expect(h.current?.scrollY).toBe(0)
	})

	it('restores the saved scroll position when moving back', () => {
		const h = createHistory()
		setScrollY(120)
		pushHistory(h, '/a')

		setScrollY(40)
		window.location.pathname = '/b'
		h.pushState('/b')

		// simulate the browser moving back to /a
		window.location.pathname = '/a'
		const entry = h.onPopState()

		expect(entry.scrollY).toBe(40)
	})
})
