import { describe, expect, it } from 'vitest'

import type { Solas } from '../../../../src/solas.js'
import { RequestContext } from '../../../../src/internal/env/request-context.js'

describe('RequestContext', () => {
	describe('use', () => {
		it('throws when no context is available', () => {
			expect(() => RequestContext.use()).toThrow('no request context is available')
		})
	})

	describe('write', () => {
		it('provides request context to the callback', async () => {
			const req = Object.assign(new Request('http://localhost/test'), {
				__SOLAS__: { match: null },
			}) as Solas.Request

			const ctx = { request: req, prerender: null as const, cache: {} }

			const result = await RequestContext.write(ctx, () => {
				const current = RequestContext.use()
				return current.request.url
			})

			expect(result).toBe('http://localhost/test')
		})

		it('provides prerender mode', async () => {
			const req = Object.assign(new Request('http://localhost'), {
				__SOLAS__: { match: null },
			}) as Solas.Request

			const ctx = { request: req, prerender: 'full' as const, cache: {} }

			const result = await RequestContext.write(ctx, () => {
				return RequestContext.use().prerender
			})

			expect(result).toBe('full')
		})

		it('provides cache object', async () => {
			const req = Object.assign(new Request('http://localhost'), {
				__SOLAS__: { match: null },
			}) as Solas.Request

			const cache = { headers: new Map([['x-test', 'value']]) }
			const ctx = { request: req, prerender: null as const, cache }

			const result = await RequestContext.write(ctx, () => {
				return RequestContext.use().cache
			})

			expect(result).toBe(cache)
		})

		it('supports async callbacks', async () => {
			const req = Object.assign(new Request('http://localhost'), {
				__SOLAS__: { match: null },
			}) as Solas.Request

			const ctx = { request: req, prerender: null as const, cache: {} }

			const result = await RequestContext.write(ctx, async () => {
				await new Promise(r => setTimeout(r, 10))
				return RequestContext.use().request.url
			})

			expect(result).toBe('http://localhost/')
		})

		it('isolates nested contexts', async () => {
			const req1 = Object.assign(new Request('http://localhost/outer'), {
				__SOLAS__: { match: null },
			}) as Solas.Request

			const req2 = Object.assign(new Request('http://localhost/inner'), {
				__SOLAS__: { match: null },
			}) as Solas.Request

			const result = await RequestContext.write(
				{ request: req1, prerender: null, cache: {} },
				async () => {
					const outerUrl = RequestContext.use().request.url
					const innerUrl = await RequestContext.write(
						{ request: req2, prerender: null, cache: {} },
						() => RequestContext.use().request.url,
					)
					return { outerUrl, innerUrl }
				},
			)

			expect(result.outerUrl).toBe('http://localhost/outer')
			expect(result.innerUrl).toBe('http://localhost/inner')
		})

		it('context is not available after write completes', async () => {
			const req = Object.assign(new Request('http://localhost'), {
				__SOLAS__: { match: null },
			}) as Solas.Request

			const ctx = { request: req, prerender: null as const, cache: {} }

			await RequestContext.write(ctx, () => RequestContext.use())
			expect(() => RequestContext.use()).toThrow()
		})
	})
})
