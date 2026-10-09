import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@vitejs/plugin-rsc/rsc', () => ({
	createTemporaryReferenceSet: vi.fn(),
	decodeAction: vi.fn(),
	decodeFormState: vi.fn(),
	decodeReply: vi.fn(),
	loadServerAction: vi.fn(),
}))

import { HttpRouter } from '../../../../src/internal/http-router/router.js'
import {
	getAlternatePathname,
	normalisePathname,
	toPathPattern,
} from '../../../../src/internal/http-router/utils.js'
import { nodeAssets } from '../../../../src/internal/runtimes/assets.js'

const ok = () => new Response('ok')
const handler = () => vi.fn().mockReturnValue(new Response('ok'))
const http = (path: string) => new Request(`http://localhost${path}`)

describe('toPathPattern', () => {
	it('returns root pattern for "/"', () => {
		expect(toPathPattern('/')).toEqual({ path: '/', wildcardNames: new Set() })
	})

	it('converts a static route', () => {
		expect(toPathPattern('/about').path).toBe('/about')
	})

	it('converts dynamic :param segments', () => {
		expect(toPathPattern('/posts/:id').path).toBe('/posts/:id')
	})

	it('names wildcard params', () => {
		const r = toPathPattern('/docs/*', ['slug'])
		expect(r.path).toBe('/docs/*slug')
		expect(r.wildcardNames).toEqual(new Set(['slug']))
	})

	it('escapes regex chars in static segments', () => {
		expect(toPathPattern('/search.+').path).toBe('/search\\.\\+')
	})
})

describe('normalisePathname', () => {
	it('preserves root', () => expect(normalisePathname('/')).toBe('/'))
	it('strips trailing slash with "never"', () =>
		expect(normalisePathname('/about/', 'never')).toBe('/about'))
	it('adds trailing slash with "always"', () =>
		expect(normalisePathname('/about', 'always')).toBe('/about/'))
	it('passes through with "ignore"', () =>
		expect(normalisePathname('/about/', 'ignore')).toBe('/about/'))
	it('defaults to "never"', () => expect(normalisePathname('/about/')).toBe('/about'))
})

describe('getAlternatePathname', () => {
	it('swaps trailing slash', () => {
		expect(getAlternatePathname('/about')).toBe('/about/')
		expect(getAlternatePathname('/about/')).toBe('/about')
	})
	it('returns root for root', () => expect(getAlternatePathname('/')).toBe('/'))
})

describe('HttpRouter', () => {
	function createRouter() {
		return new HttpRouter()
	}
	function addRoute(router: HttpRouter, path: string, h = handler()) {
		return router.add(path, 'GET', h)
	}

	describe('static routes', () => {
		it('matches a registered GET route', async () => {
			const h = handler()
			const router = addRoute(createRouter(), '/', h)

			const res = await router.fetch(http('/'))
			expect(res.status).toBe(200)
			expect(await res.text()).toBe('ok')
		})

		it('returns 404 for unmatched routes', async () => {
			const res = await createRouter().fetch(http('/nope'))
			expect(res.status).toBe(404)
		})

		it('matches HEAD against GET when HEAD not registered', async () => {
			const h = handler()
			const router = addRoute(createRouter(), '/page', h)

			const res = await router.fetch(
				new Request('http://localhost/page', { method: 'HEAD' }),
			)
			expect(res.status).toBe(200)
		})

		it('uses method-specific HEAD handler when registered', async () => {
			const h = vi.fn().mockReturnValue(new Response('head-ok'))
			const router = createRouter().add('/page', 'GET', ok).add('/page', 'HEAD', h)

			const res = await router.fetch(
				new Request('http://localhost/page', { method: 'HEAD' }),
			)
			expect(await res.text()).toBe('head-ok')
		})
	})

	describe('dynamic routes', () => {
		it('extracts :param values', async () => {
			const router = createRouter().add('/posts/:id', 'GET', async req => {
				const meta = req.__SOLAS__
				return new Response(JSON.stringify(meta.match!.params))
			})
			const res = await router.fetch(http('/posts/42'))
			expect(await res.json()).toEqual({ id: '42' })
		})

		it('prefers static over dynamic for same-length paths', async () => {
			const router = createRouter()
				.add('/:slug', 'GET', () => new Response('dynamic'))
				.add('/about', 'GET', () => new Response('static'))

			const res = await router.fetch(http('/about'))
			expect(await res.text()).toBe('static')
		})
	})

	describe('wildcard routes', () => {
		it('matches wildcard paths', async () => {
			const h = handler()
			const router = createRouter().add('/docs/*', 'GET', h)

			const res = await router.fetch(http('/docs/guide/intro'))
			expect(res.status).toBe(200)
		})

		it('does not match when path is shorter than prefix', async () => {
			const h = vi.fn()
			const router = createRouter().add('/docs/*', 'GET', h)
			await router.fetch(http('/other'))
			expect(h).not.toHaveBeenCalled()
		})
	})

	describe('route specificity', () => {
		it('static > dynamic > wildcard', async () => {
			const router = createRouter()
				.add('/*', 'GET', () => new Response('wildcard'))
				.add('/:slug', 'GET', () => new Response('dynamic'))
				.add('/static', 'GET', () => new Response('static'))

			const fetchText = async (p: string) => (await router.fetch(http(p))).text()
			expect(await fetchText('/static')).toBe('static')
			expect(await fetchText('/dynamic-slug')).toBe('dynamic')
		})

		it('prefers longer prefix match in wildcards', async () => {
			const router = createRouter()
				.add('/a/*', 'GET', () => new Response('short'))
				.add('/a/b/*', 'GET', () => new Response('long'))

			const res = await router.fetch(http('/a/b/c'))
			expect(await res.text()).toBe('long')
		})
	})

	describe('trailing slash', () => {
		it('"always" redirects non-trailing to trailing', async () => {
			const router = new HttpRouter({ trailingSlash: 'always' }).add('/about/', 'GET', ok)

			const res = await router.fetch(http('/about'))
			expect(res.status).toBe(308)
			expect(res.headers.get('location')).toMatch(/\/about\/$/)
		})

		it('"never" redirects trailing to non-trailing', async () => {
			const router = new HttpRouter({ trailingSlash: 'never' }).add('/about', 'GET', ok)

			const res = await router.fetch(http('/about/'))
			expect(res.status).toBe(308)
		})

		it('"ignore" accepts both forms on a static route', async () => {
			const h = handler()
			const router = new HttpRouter({ trailingSlash: 'ignore' }).add('/about', 'GET', h)

			expect((await router.fetch(http('/about'))).status).toBe(200)
			expect((await router.fetch(http('/about/'))).status).toBe(200)
		})
	})

	describe('middleware', () => {
		function mw(name: string): HttpRouter.Middleware {
			return async (_, next) => {
				order.push(name)
				return next()
			}
		}
		let order: string[]

		beforeEach(() => {
			order = []
		})

		it('runs global middleware before handler', async () => {
			const router = createRouter()
				.use(mw('global'))
				.add('/test', 'GET', async () => {
					order.push('handler')
					return new Response('ok')
				})

			await router.fetch(http('/test'))
			expect(order).toEqual(['global', 'handler'])
		})

		it('runs route middleware before handler', async () => {
			const router = createRouter().add(
				'/test',
				'GET',
				async () => {
					order.push('handler')
					return new Response('ok')
				},
				[],
				[mw('mw')],
			)

			await router.fetch(http('/test'))
			expect(order).toEqual(['mw', 'handler'])
		})

		it('global runs before route middleware', async () => {
			const router = createRouter()
				.use(mw('global'))
				.add(
					'/test',
					'GET',
					async () => {
						order.push('handler')
						return new Response('ok')
					},
					[],
					[mw('route-mw')],
				)

			await router.fetch(http('/test'))
			expect(order).toEqual(['global', 'route-mw', 'handler'])
		})

		it('middleware can short-circuit the handler', async () => {
			const router = createRouter()
				.use(async () => new Response('blocked', { status: 403 }))
				.add('/test', 'GET', ok)

			const res = await router.fetch(http('/test'))
			expect(res.status).toBe(403)
			expect(await res.text()).toBe('blocked')
		})

		it('throws on double next() call', async () => {
			const router = createRouter().add(
				'/test',
				'GET',
				ok,
				[],
				[
					async (_, next) => {
						await next()
						return next()
					},
				],
			)

			await expect(router.fetch(http('/test'))).rejects.toThrow(
				'next() called more than once',
			)
		})
	})

	describe('error handling', () => {
		it('custom error handler catches routing failures', async () => {
			const router = createRouter().error(() => new Response('caught', { status: 418 }))

			const res = await router.fetch(http('/nonexistent'))
			expect(res.status).toBe(418)
		})

		it('custom error handler catches handler throws', async () => {
			const router = createRouter()
				.add('/boom', 'GET', () => {
					throw new Error('kaboom')
				})
				.error(err => new Response(err.message, { status: 500 }))

			const res = await router.fetch(http('/boom'))
			expect(res.status).toBe(500)
			expect(await res.text()).toBe('kaboom')
		})

		it('default 500 for handler throws without error handler', async () => {
			const router = createRouter().add('/boom', 'GET', () => {
				throw new Error('kaboom')
			})

			const res = await router.fetch(http('/boom'))
			expect(res.status).toBe(500)
		})
	})

	describe('route metadata on request', () => {
		it('attaches match metadata for matched routes', async () => {
			const router = createRouter().add('/meta', 'GET', async req => {
				const meta = req.__SOLAS__
				expect(meta.match).toBeTruthy()
				expect(meta.match?.route.path).toBe('/meta')
				expect(meta.action).toBe(false)
				return new Response('ok')
			})

			const res = await router.fetch(http('/meta'))
			expect(res.status).toBe(200)
		})

		it('attaches error metadata for unmatched routes', async () => {
			const router = createRouter().error((_err, req) => {
				const meta = req.__SOLAS__
				expect(meta.match).toBeNull()
				expect(meta.error).toBeTruthy()
				return new Response('error', { status: 404 })
			})

			await router.fetch(http('/absent'))
		})
	})

	describe('serveStatic', () => {
		it('returns 404 for missing files', async () => {
			const res = await HttpRouter.serveStatic(
				nodeAssets,
				{ namespace: 'client', path: 'nonexistent/file.txt' },
				http('/'),
			)
			expect(res.status).toBe(404)
		})
	})
})
