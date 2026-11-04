import { describe, it, expect } from 'vitest'

import { EntryKind, Finder } from '../../../src/internal/build.js'

describe('Build', () => {
	describe('EntryKind', () => {
		it('has expected constants', () => {
			expect(EntryKind.SHELL).toBe('$S')
			expect(EntryKind.LAYOUT).toBe('$L')
			expect(EntryKind.PAGE).toBe('$P')
			expect(EntryKind['401']).toBe('$401')
			expect(EntryKind['403']).toBe('$403')
			expect(EntryKind['404']).toBe('$404')
			expect(EntryKind['500']).toBe('$500')
			expect(EntryKind.LOADING).toBe('$LOAD')
			expect(EntryKind.MIDDLEWARE).toBe('$MW')
			expect(EntryKind.ENDPOINT).toBe('$E')
		})
	})

	describe('Finder', () => {
		describe('getParams', () => {
			it('returns empty array for static paths', () => {
				expect(Finder.getParams('/about')).toEqual([])
			})

			it('extracts a single :param from file path', () => {
				expect(Finder.getParams('app/posts/[id]/+page.tsx')).toEqual(['id'])
			})

			it('extracts multiple params', () => {
				expect(Finder.getParams('app/[lang]/posts/[id]/+page.tsx')).toEqual([
					'lang',
					'id',
				])
			})

			it('extracts rest params [...slug]', () => {
				expect(Finder.getParams('app/docs/[...slug]/+page.tsx')).toEqual(['slug'])
			})

			it('extracts mixed named and rest params', () => {
				const params = Finder.getParams('app/[lang]/docs/[...path]/+page.tsx')
				expect(params).toEqual(['lang', 'path'])
			})
		})

		describe('getDepth', () => {
			it('returns 0 for root', () => {
				expect(Finder.getDepth('/')).toBe(0)
			})

			it('returns depth for top-level routes', () => {
				expect(Finder.getDepth('/about')).toBe(1)
			})

			it('returns depth for nested routes', () => {
				expect(Finder.getDepth('/posts/2024/my-post')).toBe(3)
			})

			it('handles dynamic routes', () => {
				expect(Finder.getDepth('/posts/:id')).toBe(2)
			})
		})

		describe('toCanonicalRoute', () => {
			it('returns root for empty path', () => {
				expect(Finder.toCanonicalRoute('')).toBe('/')
			})

			it('strips app/ prefix and +page suffix', () => {
				expect(Finder.toCanonicalRoute('app/about/+page.tsx')).toBe('/about')
			})

			it('strips +page.jsx suffix', () => {
				expect(Finder.toCanonicalRoute('app/about/+page.jsx')).toBe('/about')
			})

			it('strips +endpoint suffix', () => {
				expect(Finder.toCanonicalRoute('app/api/data/+endpoint.ts')).toBe('/api/data')
			})

			it('handles root page', () => {
				expect(Finder.toCanonicalRoute('app/+page.tsx')).toBe('/')
			})

			it('converts [param] to :param', () => {
				expect(Finder.toCanonicalRoute('app/posts/[id]/+page.tsx')).toBe('/posts/:id')
			})

			it('converts [...wildcard] to *', () => {
				expect(Finder.toCanonicalRoute('app/docs/[...slug]/+page.tsx')).toBe('/docs/*')
			})

			it('handles mixed static and dynamic segments', () => {
				expect(Finder.toCanonicalRoute('app/[lang]/about/+page.tsx')).toBe('/:lang/about')
			})

			it('handles endpoint files with +endpoint.ts', () => {
				expect(Finder.toCanonicalRoute('app/api/users/+endpoint.ts')).toBe('/api/users')
			})

			it('handles endpoint files with +endpoint.js', () => {
				expect(Finder.toCanonicalRoute('app/api/data/+endpoint.js')).toBe('/api/data')
			})

			it('handles endpoint files with +endpoint.mts', () => {
				expect(Finder.toCanonicalRoute('app/api/data/+endpoint.mts')).toBe('/api/data')
			})

			it('handles endpoint files with +endpoint.mjs', () => {
				expect(Finder.toCanonicalRoute('app/api/data/+endpoint.mjs')).toBe('/api/data')
			})

			it.each([
				['app/(marketing)/+page.tsx', '/'],
				['app/(marketing)/about/+page.tsx', '/about'],
				['app/blog/(comments)/[slug]/+page.tsx', '/blog/:slug'],
			])('strips route groups in %s', (file, expected) => {
				expect(Finder.toCanonicalRoute(file)).toBe(expected)
			})

			it('does not strip literal parentheses inside a segment', () => {
				expect(Finder.toCanonicalRoute('app/foo(bar)/+page.tsx')).toBe('/foo(bar)')
			})
		})

		describe('getImportPath', () => {
			it('generates a relative import path from cwd to generated dir', () => {
				const cwd = process.cwd()
				const file = `${cwd}/app/about/+page.tsx`
				const result = Finder.getImportPath(file)
				expect(result).toContain('app/about/+page')
				expect(result).not.toMatch(/\.(t|j)sx?$/)
			})

			it('normalises backslashes on windows', () => {
				const cwd = process.cwd().replace(/\//g, '\\')
				const file = `${cwd}\\app\\about\\+page.tsx`
				const result = Finder.getImportPath(file)
				expect(result).not.toContain('\\')
			})

			it('strips typescript extension', () => {
				const cwd = process.cwd()
				const result = Finder.getImportPath(`${cwd}/app/page/+page.tsx`)
				expect(result).not.toMatch(/\.tsx$/)
			})

			it.each(['mts', 'mjs'])('strips the %s extension', ext => {
				const cwd = process.cwd()
				const result = Finder.getImportPath(`${cwd}/app/api/data/+endpoint.${ext}`)
				expect(result).not.toMatch(new RegExp(`\\.${ext}$`))
			})
		})
	})
})
