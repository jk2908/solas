import { describe, expect, it, vi } from 'vitest'

vi.mock('@vitejs/plugin-rsc/rsc', () => ({
	renderToReadableStream: vi.fn(
		() =>
			new ReadableStream<Uint8Array>({
				start(controller) {
					controller.close()
				},
			}),
	),
}))

import type { Assets } from '../../../../src/internal/assets.js'
import type { RuntimeConfig } from '../../../../src/types.js'
import * as Config from '../../../../src/config.js'
import { createHandler } from '../../../../src/internal/env/rsc.js'
import { Resolver } from '../../../../src/internal/resolver.js'
import { createSegment } from '../../../utils.js'

const config = {
	precompress: false,
	trailingSlash: 'never',
	trustedOrigins: [],
} as RuntimeConfig

describe('createHandler', () => {
	it('prefetches dynamic routes in full', async () => {
		const handler = createHandler(
			config,
			{ '/dynamic': createSegment('/dynamic', { prerender: false }) },
			{ 'p_/dynamic': { middlewares: [] } },
		)

		const response = await handler.fetch(
			new Request('http://localhost/dynamic', {
				headers: {
					accept: 'text/x-component',
					[`x-${Config.SLUG}-prefetch`]: '1',
				},
			}),
		)

		expect(response.status).toBe(200)
		expect(response.headers.get(`x-${Config.SLUG}-route-type`)).toBe('dynamic')
		expect(response.body).not.toBeNull()
	})

	it('returns a bodyless prefetch response for routes that are not fully prerendered', async () => {
		const handler = createHandler(
			config,
			{ '/writing': createSegment('/writing', { prerender: 'ppr' }) },
			{ 'p_/writing': { middlewares: [] } },
		)

		const response = await handler.fetch(
			new Request('http://localhost/writing', {
				headers: { [`x-${Config.SLUG}-prefetch`]: '1' },
			}),
		)

		expect(response.status).toBe(204)
		expect(response.body).toBeNull()
		expect(response.headers.get(`x-${Config.SLUG}-route-type`)).toBe('ppr')
	})

	it('returns the ppr shell when a shell artifact exists', async () => {
		const shell = '0:["$","div",null,{"children":"shell"}]'
		const assets = {
			exists: vi.fn(async () => true),
			readText: vi.fn(async () => shell),
		} as unknown as Assets
		const handler = createHandler(
			config,
			{ '/writing': createSegment('/writing', { prerender: 'ppr' }) },
			{ 'p_/writing': { middlewares: [] } },
			{ assets },
		)

		const response = await handler.fetch(
			new Request('http://localhost/writing', {
				headers: {
					accept: 'text/x-component',
					[`x-${Config.SLUG}-prefetch`]: '1',
				},
			}),
		)

		expect(response.status).toBe(200)
		expect(response.headers.get(`x-${Config.SLUG}-route-type`)).toBe('ppr')
		expect(await response.text()).toBe(shell)
	})

	it('does not enhance a route for a PPR prefetch', async () => {
		const enhance = vi.spyOn(Resolver.prototype, 'enhance')
		const handler = createHandler(
			config,
			{ '/writing': createSegment('/writing', { prerender: 'ppr' }) },
			{ 'p_/writing': { middlewares: [] } },
		)

		const response = await handler.fetch(
			new Request('http://localhost/writing', {
				headers: { [`x-${Config.SLUG}-prefetch`]: '1' },
			}),
		)

		expect(response.status).toBe(204)
		expect(enhance).not.toHaveBeenCalled()

		enhance.mockRestore()
	})

	it('uses a full artifact mode for a declared PPR route', async () => {
		const handler = createHandler(
			config,
			{ '/writing': createSegment('/writing', { prerender: 'ppr' }) },
			{ 'p_/writing': { middlewares: [] } },
			{
				runtimeManifest: {
					artifacts: { '/writing': { mode: 'full' } },
					publicFiles: new Set(),
				},
			},
		)

		const response = await handler.fetch(
			new Request('http://localhost/writing', {
				headers: {
					accept: 'text/x-component',
					[`x-${Config.SLUG}-prefetch`]: '1',
				},
			}),
		)

		expect(response.status).toBe(200)
		expect(response.headers.get(`x-${Config.SLUG}-route-type`)).toBe('full')
		expect(response.body).not.toBeNull()
	})
})
