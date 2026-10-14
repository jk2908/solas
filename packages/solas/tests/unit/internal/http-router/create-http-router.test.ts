import { describe, it, expect, vi } from 'vitest'

vi.mock('@vitejs/plugin-rsc/rsc', () => ({
	createTemporaryReferenceSet: vi.fn(),
	decodeAction: vi.fn(),
	decodeFormState: vi.fn(),
	decodeReply: vi.fn(),
	loadServerAction: vi.fn(),
}))

import { createHttpRouter } from '../../../../src/internal/http-router/create-http-router.js'
import { HttpRouter } from '../../../../src/internal/http-router/router.js'

const rsc = () => new Response('rsc')

function makeManifestEntry(
	id: string,
	path: string,
	kind: string,
	overrides: Record<string, unknown> = {},
) {
	return {
		__id: id,
		__path: path,
		__params: [],
		__kind: kind,
		method: 'get',
		...overrides,
	}
}

function pageEntry(path: string, id?: string) {
	return makeManifestEntry(id ?? path.replace(/[^a-z]/g, ''), path, '$P', {
		paths: {
			layouts: [],
			'401s': [],
			'403s': [],
			'404s': [],
			'500s': [],
			loaders: [],
			middlewares: [],
		},
	})
}

function endpointEntry(path: string, id?: string) {
	return makeManifestEntry(id ?? `${path.replace(/[^a-z]/g, '')}-endpoint`, path, '$E')
}

describe('createHttpRouter', () => {
	it('creates a router from page-only manifest', () => {
		const manifest: any = { '/about': [pageEntry('/about')] }
		const importMap: any = { about: { middlewares: [] } }

		const router = createHttpRouter({}, manifest, importMap, rsc)
		expect(router).toBeInstanceOf(HttpRouter)
	})

	it('throws for standalone endpoint with missing handler', () => {
		const manifest: any = { '/api/data': [endpointEntry('/api/data', 'api')] }
		const importMap: any = { api: {} }

		expect(() => createHttpRouter({}, manifest, importMap, rsc)).toThrow(
			'Missing endpoint handler',
		)
	})

	it('creates a router from endpoint-only manifest with handler', () => {
		const endpointHandler = () => new Response('data')
		const manifest: any = { '/api/data': [endpointEntry('/api/data', 'api-data')] }
		const importMap: any = { 'api-data': { endpoint: endpointHandler } }

		const router = createHttpRouter({}, manifest, importMap, rsc)
		expect(router).toBeInstanceOf(HttpRouter)
	})

	it('creates a unified page+endpoint route', () => {
		const endpointHandler = () => new Response('json-data')
		const manifest: any = {
			'/page': [pageEntry('/page', 'page'), endpointEntry('/page', 'page-endpoint')],
		}
		const importMap: any = {
			page: { middlewares: [] },
			'page-endpoint': { endpoint: endpointHandler },
		}

		const router = createHttpRouter({}, manifest, importMap, rsc)
		expect(router).toBeInstanceOf(HttpRouter)
	})

	it('throws for over-length route groups', () => {
		const manifest: any = { '/bad': [{}, {}, {}] }
		expect(() => createHttpRouter({}, manifest, {}, rsc)).toThrow(
			'Unexpected route group length',
		)
	})

	it('throws for unified group without page entry', () => {
		const manifest: any = {
			'/bad': [endpointEntry('/bad', 'e'), endpointEntry('/bad', 'e2')],
		}
		expect(() => createHttpRouter({}, manifest, {}, rsc)).toThrow('missing page entry')
	})

	it('runs middleware before serving a full prerender', async () => {
		const order: string[] = []

		const middleware: HttpRouter.Middleware = async (_req, next) => {
			order.push('middleware')

			const res = await next()
			res.headers.set('x-middleware', 'ran')

			return res
		}

		const servePrerender = vi.fn(async () => {
			order.push('prerender')
			return new Response('static')
		})

		const manifest: any = { '/about': [pageEntry('/about')] }
		const importMap: any = { about: { middlewares: [middleware] } }

		const router = createHttpRouter({}, manifest, importMap, rsc, servePrerender)
		const res = await router.fetch(
			new Request('https://example.com/about', { headers: { accept: 'text/html' } }),
		)

		expect(order).toEqual(['middleware', 'prerender'])
		expect(await res.text()).toBe('static')
		expect(res.headers.get('x-middleware')).toBe('ran')
	})

	it('lets a short-circuiting middleware win over a prerender', async () => {
		const middleware: HttpRouter.Middleware = () =>
			new Response('blocked', { status: 403 })
		const servePrerender = vi.fn(async () => new Response('static'))

		const manifest: any = { '/about': [pageEntry('/about')] }
		const importMap: any = { about: { middlewares: [middleware] } }

		const router = createHttpRouter({}, manifest, importMap, rsc, servePrerender)
		const res = await router.fetch(new Request('https://example.com/about'))

		expect(res.status).toBe(403)
		expect(servePrerender).not.toHaveBeenCalled()
	})

	it('renders rsc when there is no prerender to serve', async () => {
		const servePrerender = vi.fn(async () => null)

		const manifest: any = { '/about': [pageEntry('/about')] }
		const importMap: any = { about: { middlewares: [] } }

		const router = createHttpRouter({}, manifest, importMap, rsc, servePrerender)
		const res = await router.fetch(new Request('https://example.com/about'))

		expect(await res.text()).toBe('rsc')
		expect(servePrerender).toHaveBeenCalledOnce()
	})
})
