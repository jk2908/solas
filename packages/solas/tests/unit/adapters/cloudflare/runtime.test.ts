import { describe, it, expect, vi } from 'vitest'

import { createCloudflareAssets } from '../../../../src/adapters/cloudflare/runtime.js'

function createAssets(files: Record<string, { body: string; status?: number }>) {
	const fetch = vi.fn(async (input: RequestInfo | URL) => {
		const url = new URL(typeof input === 'string' ? input : input.toString())
		const file = files[url.pathname]

		if (!file) return new Response('Not found', { status: 404 })

		return new Response(file.body, {
			status: file.status ?? 200,
			headers: { 'content-type': 'application/octet-stream' },
		})
	})

	return { fetch }
}

describe('createCloudflareAssets', () => {
	it('maps the artifact namespace onto the artifact prefix', async () => {
		const assets = createAssets({
			'/_solas-artifacts/runtime-manifest.json': { body: '{"artifacts":{}}' },
		})
		const store = createCloudflareAssets({ ASSETS: assets })

		const ref = { namespace: 'artifact', path: 'runtime-manifest.json' } as const

		expect(await store.exists(ref)).toBe(true)
		expect(await store.readText(ref)).toBe('{"artifacts":{}}')
		expect(assets.fetch).toHaveBeenCalledWith(
			'https://solas-assets.invalid/_solas-artifacts/runtime-manifest.json',
			expect.anything(),
		)
	})

	it('maps client onto the asset root and prerenders under the artifact prefix', async () => {
		const assets = createAssets({
			'/_solas/index-abc.js': { body: 'console.log(1)' },
			'/logo.svg': { body: '<svg/>' },
			'/_solas-artifacts/static/about.html': { body: '<html>about</html>' },
		})
		const store = createCloudflareAssets({ ASSETS: assets })

		expect(
			await store.readText({ namespace: 'client', path: '_solas/index-abc.js' }),
		).toBe('console.log(1)')
		expect(await store.readText({ namespace: 'client', path: 'logo.svg' })).toBe('<svg/>')
		expect(await store.readText({ namespace: 'static', path: 'about.html' })).toBe(
			'<html>about</html>',
		)
		expect(assets.fetch).toHaveBeenCalledWith(
			'https://solas-assets.invalid/_solas-artifacts/static/about.html',
			expect.anything(),
		)
	})

	it('returns false for missing files', async () => {
		const assets = createAssets({})
		const store = createCloudflareAssets({ ASSETS: assets })

		expect(await store.exists({ namespace: 'artifact', path: 'missing.json' })).toBe(
			false,
		)
		expect(await store.exists({ namespace: 'static', path: 'missing.html' })).toBe(false)
	})

	it('readBuffer returns an ArrayBuffer', async () => {
		const assets = createAssets({ '/data.json': { body: 'hello' } })
		const store = createCloudflareAssets({ ASSETS: assets })
		const buffer = await store.readBuffer({ namespace: 'client', path: 'data.json' })

		expect(buffer).toBeInstanceOf(ArrayBuffer)
		expect(new TextDecoder().decode(buffer)).toBe('hello')
	})

	it('throws when reading a missing file', async () => {
		const assets = createAssets({})
		const store = createCloudflareAssets({ ASSETS: assets })

		await expect(
			store.readText({ namespace: 'client', path: 'missing.js' }),
		).rejects.toThrow(/asset not found/)
	})

	it('throws when no ASSETS binding is present', () => {
		expect(() => createCloudflareAssets({})).toThrow(/ASSETS/)
	})
})
