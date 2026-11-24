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

import type { RuntimeConfig } from '../../../../src/types.js'
import * as Config from '../../../../src/config.js'
import { createHandler } from '../../../../src/internal/env/rsc.js'
import { revalidatePath } from '../../../../src/internal/server/revalidate.js'
import { createEndpoint, createSegment } from '../../../utils.js'

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

	it('returns a segmentable shell for PPR prefetches', async () => {
		const handler = createHandler(
			config,
			{ '/writing': createSegment('/writing', { prerender: 'ppr' }) },
			{ 'p_/writing': { middlewares: [] } },
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
		expect(response.body).not.toBeNull()
		expect(response.headers.get(`x-${Config.SLUG}-route-type`)).toBe('ppr')
	})

	it('returns a page/layout patch for a patch request', async () => {
		const handler = createHandler(
			config,
			{ '/writing': createSegment('/writing', { prerender: 'ppr' }) },
			{ 'p_/writing': { middlewares: [] } },
		)

		const response = await handler.fetch(
			new Request('http://localhost/writing', {
				headers: {
					accept: 'text/x-component',
					[`x-${Config.SLUG}-segment`]: 'patch',
					[`x-${Config.SLUG}-router-state`]: JSON.stringify({
						segments: [],
					}),
				},
			}),
		)

		expect(response.status).toBe(200)
		expect(response.body).not.toBeNull()
		expect(response.headers.get(`x-${Config.SLUG}-route-type`)).toBe('ppr')
		expect(response.headers.get(`x-${Config.SLUG}-segment`)).toBe('patch')
	})

	it('does not serve the shell for a patch prefetch', async () => {
		const handler = createHandler(
			config,
			{ '/writing': createSegment('/writing', { prerender: 'ppr' }) },
			{ 'p_/writing': { middlewares: [] } },
			{
				assets: {
					exists: async () => true,
					readText: async () => '0:{}',
					readBuffer: async () => new ArrayBuffer(0),
					mimeType: () => 'application/octet-stream',
				},
			},
		)

		const response = await handler.fetch(
			new Request('http://localhost/writing', {
				headers: {
					accept: 'text/x-component',
					[`x-${Config.SLUG}-prefetch`]: '1',
					[`x-${Config.SLUG}-segment`]: 'patch',
					[`x-${Config.SLUG}-router-state`]: JSON.stringify({
						tree: { id: 'shell', kind: 'shell' },
					}),
				},
			}),
		)

		expect(response.status).toBe(200)
		expect(response.headers.get(`x-${Config.SLUG}-route-type`)).toBe('ppr')
		expect(response.headers.get(`x-${Config.SLUG}-segment`)).toBe('patch')
	})

	it('reuses the shell artifact for repeated patch prefetches', async () => {
		let reads = 0
		const handler = createHandler(
			config,
			{ '/writing': createSegment('/writing', { prerender: 'ppr' }) },
			{ 'p_/writing': { middlewares: [] } },
			{
				assets: {
					exists: async () => true,
					readText: async () => {
						reads += 1
						return '0:{}'
					},
					readBuffer: async () => new ArrayBuffer(0),
					mimeType: () => 'application/octet-stream',
				},
			},
		)

		const request = () =>
			new Request('http://localhost/writing', {
				headers: {
					accept: 'text/x-component',
					[`x-${Config.SLUG}-prefetch`]: '1',
					[`x-${Config.SLUG}-segment`]: 'patch',
					[`x-${Config.SLUG}-router-state`]: JSON.stringify({
						tree: { id: 'shell', kind: 'shell' },
					}),
				},
			})

		await handler.fetch(request())
		await handler.fetch(request())

		expect(reads).toBe(1)
	})

	it('publishes route handler invalidations to the revalidation stream', async () => {
		const handler = createHandler(
			config,
			{ '/api/revalidate': createEndpoint('/api/revalidate') },
			{
				'e_/api/revalidate': {
					endpoint: () => {
						revalidatePath('/posts')
						return Response.json({ ok: true })
					},
				},
			},
		)

		const stream = await handler.fetch(new Request('http://localhost/_solas/revalidate'))
		const reader = stream.body!.getReader()
		const decoder = new TextDecoder()

		expect(decoder.decode((await reader.read()).value)).toContain('connected')

		await handler.fetch(new Request('http://localhost/api/revalidate'))

		const event = decoder.decode((await reader.read()).value)
		expect(event).toContain('data:')
		expect(event).toContain('/posts')

		await reader.cancel()
	})

	it('exposes a revalidation stream', async () => {
		const handler = createHandler(config, {}, {})
		const response = await handler.fetch(
			new Request('http://localhost/_solas/revalidate'),
		)

		expect(response.headers.get('content-type')).toContain('text/event-stream')
		expect(response.body).not.toBeNull()

		const reader = response.body!.getReader()
		const first = await reader.read()
		expect(new TextDecoder().decode(first.value)).toContain('connected')
		await reader.cancel()
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
