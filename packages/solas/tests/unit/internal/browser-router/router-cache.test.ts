import { describe, expect, it, vi } from 'vitest'

import { RouterCache } from '../../../../src/internal/browser-router/router-cache.js'

function settle() {
	return new Promise(resolve => setTimeout(resolve, 0))
}

function cached(path: string, bytes: number): RouterCache.CachedPayload {
	return {
		payload: { root: null, url: { pathname: path } },
		url: path,
		bytes,
	}
}

function stream(
	path: string,
	bytes: number,
	type: RouterCache.Type = 'full',
): RouterCache.DecodedStream {
	return {
		payload: Promise.resolve({ root: null, url: { pathname: path } }),
		bytes: Promise.resolve(bytes),
		url: path,
		type,
	}
}

describe('RouterCache', () => {
	it('promotes a pending entry to ready', async () => {
		const cache = new RouterCache()
		const promise = Promise.resolve(stream('/about', 10))

		cache.set('/about', promise)
		expect(cache.get('/about')?.status).toBe('pending')

		await promise
		await settle()

		const entry = cache.get('/about')
		expect(entry?.status).toBe('ready')
		if (entry?.status !== 'ready') throw new Error('expected ready entry')
		expect(entry.value.payload.url.pathname).toBe('/about')
		expect(entry.value.bytes).toBe(10)
	})

	it('removes an entry when the promise fails', async () => {
		const cache = new RouterCache()
		const promise = Promise.reject(new Error('failed'))

		cache.set('/about', promise)
		await promise.catch(() => {})
		await Promise.resolve()

		expect(cache.has('/about')).toBe(false)
	})

	it('stores completed navigation payloads with setReady', () => {
		const cache = new RouterCache()
		cache.setReady('/about', 'full', cached('/about', 10))

		expect(cache.get('/about')?.status).toBe('ready')
	})

	it('expires dynamic payloads after the ttl', async () => {
		vi.useFakeTimers()
		const cache = new RouterCache({ mode: 'all', ttl: 1000 })
		cache.setReady('/dynamic', 'dynamic', cached('/dynamic', 10))

		vi.advanceTimersByTime(999)
		expect(cache.has('/dynamic')).toBe(true)
		vi.advanceTimersByTime(1)
		expect(cache.has('/dynamic')).toBe(false)
		vi.useRealTimers()
	})

	it('stores page segments in the same cache', () => {
		const cache = new RouterCache({ mode: 'all' })
		cache.setSegment('/page:/about', 'static', cached('/about', 10))

		expect(cache.getSegment('/page:/about')?.value.payload.url.pathname).toBe('/about')
		expect(cache.hasSegment('/page:/about')).toBe(true)
		expect(cache.get('/page:/about')).toBeUndefined()
	})

	it('expires dynamic page segments after the ttl', () => {
		vi.useFakeTimers()
		const cache = new RouterCache({ mode: 'all', ttl: 1000 })
		cache.setSegment('/page:/about', 'dynamic', cached('/about', 10))

		vi.advanceTimersByTime(999)
		expect(cache.hasSegment('/page:/about')).toBe(true)
		vi.advanceTimersByTime(1)
		expect(cache.hasSegment('/page:/about')).toBe(false)
		vi.useRealTimers()
	})

	it('keeps static page segments with a null ttl', () => {
		vi.useFakeTimers()
		const cache = new RouterCache({ mode: 'all', ttl: 1000 })
		cache.setSegment('/static-page', 'dynamic', cached('/static-page', 10), {
			ttl: null,
		})

		vi.advanceTimersByTime(5000)

		expect(cache.hasSegment('/static-page')).toBe(true)
		vi.useRealTimers()
	})

	it('keeps ppr shells until the cache is cleared', () => {
		vi.useFakeTimers()
		const cache = new RouterCache({ ttl: 1000 })
		cache.setReady('/shell', 'ppr', cached('/shell', 10))

		vi.advanceTimersByTime(5000)

		expect(cache.has('/shell')).toBe(true)
		vi.useRealTimers()
	})

	it('evicts LRU entries when the byte budget is exceeded', async () => {
		const cache = new RouterCache({ maxBytes: 120 })

		cache.set('/a', Promise.resolve(stream('/a', 60)))
		cache.set('/b', Promise.resolve(stream('/b', 40)))
		await settle()

		cache.get('/a')
		cache.set('/c', Promise.resolve(stream('/c', 60)))
		await settle()

		expect(cache.has('/a')).toBe(true)
		expect(cache.has('/b')).toBe(false)
		expect(cache.has('/c')).toBe(true)
	})

	it('clears all entries and resets the byte count', async () => {
		const cache = new RouterCache()
		cache.set('/about', Promise.resolve(stream('/about', 10)))
		await settle()

		cache.clear()

		expect(cache.has('/about')).toBe(false)
	})

	it('invalidates cached segments by path', () => {
		const cache = new RouterCache({ mode: 'all' })
		cache.setSegment('/about', 'dynamic', {
			...cached('/about', 10),
		})
		cache.setSegment('/other', 'dynamic', {
			...cached('/other', 10),
		})

		cache.invalidatePath('/about')

		expect(cache.hasSegment('/about')).toBe(false)
		expect(cache.hasSegment('/other')).toBe(true)
	})

	it('invalidates descendant paths for layout scope', () => {
		const cache = new RouterCache({ mode: 'all' })
		cache.setSegment('/about/another', 'dynamic', {
			...cached('/about/another', 10),
		})

		cache.invalidatePath('/about', 'layout')

		expect(cache.hasSegment('/about/another')).toBe(false)
	})

	it('invalidates descendant paths from the root for layout scope', () => {
		const cache = new RouterCache({ mode: 'all' })
		cache.setSegment('/about', 'dynamic', {
			...cached('/about', 10),
		})

		cache.invalidatePath('/', 'layout')

		expect(cache.hasSegment('/about')).toBe(false)
	})

	it('invalidates cached paths from dynamic route patterns', () => {
		const cache = new RouterCache({ mode: 'all' })
		cache.setSegment('/posts/one', 'dynamic', {
			...cached('/posts/one', 10),
		})

		cache.invalidatePath('/posts/[slug]', 'page')

		expect(cache.hasSegment('/posts/one')).toBe(false)
	})

	it('does not retain entries when disabled', async () => {
		const cache = new RouterCache({ mode: 'off' })

		cache.set('/about', Promise.resolve(stream('/about', 10)))
		cache.setReady('/test', 'full', cached('/test', 10))
		await settle()

		expect(cache.has('/about')).toBe(false)
		expect(cache.get('/about')).toBeUndefined()
		expect(cache.has('/test')).toBe(false)
	})

	it('does not double count a replaced entry', () => {
		const cache = new RouterCache({ maxBytes: 20 })

		cache.setReady('/a', 'full', cached('/a', 10))
		cache.setReady('/a', 'full', cached('/a', 10))
		cache.setReady('/b', 'full', cached('/b', 10))

		expect(cache.has('/a')).toBe(true)
		expect(cache.has('/b')).toBe(true)
	})

	it('only retains full payloads in full-only mode', () => {
		const cache = new RouterCache({ mode: 'full-only' })

		cache.setReady('/full', 'full', cached('/full', 10))
		cache.setReady('/ppr', 'ppr', cached('/ppr', 10))
		cache.setReady('/dynamic', 'dynamic', cached('/dynamic', 10))
		cache.setSegment('/ppr', 'dynamic', cached('/ppr', 10))

		expect(cache.has('/full')).toBe(true)
		expect(cache.has('/ppr')).toBe(false)
		expect(cache.has('/dynamic')).toBe(false)
		expect(cache.hasSegment('/ppr')).toBe(false)
	})

	it('retains prerendered payloads but not dynamic data', () => {
		const cache = new RouterCache({ mode: 'prerendered' })

		cache.setReady('/full', 'full', cached('/full', 10))
		cache.setReady('/ppr', 'ppr', cached('/ppr', 10))
		cache.setReady('/dynamic', 'dynamic', cached('/dynamic', 10))
		cache.setSegment('/ppr', 'dynamic', cached('/ppr', 10))

		expect(cache.has('/full')).toBe(true)
		expect(cache.has('/ppr')).toBe(true)
		expect(cache.has('/dynamic')).toBe(false)
		expect(cache.hasSegment('/ppr')).toBe(false)
	})

	it('drops a promoted dynamic payload in prerendered mode', async () => {
		const cache = new RouterCache({ mode: 'prerendered' })
		const promise = Promise.resolve(stream('/dynamic', 10, 'dynamic'))

		cache.set('/dynamic', promise)
		expect(cache.get('/dynamic')?.status).toBe('pending')

		await promise
		await settle()

		expect(cache.has('/dynamic')).toBe(false)
	})

	it('retains dynamic payloads and segments in all mode', () => {
		const cache = new RouterCache({ mode: 'all' })

		cache.setReady('/dynamic', 'dynamic', cached('/dynamic', 10))
		cache.setSegment('/dynamic', 'dynamic', cached('/dynamic', 10))

		expect(cache.has('/dynamic')).toBe(true)
		expect(cache.hasSegment('/dynamic')).toBe(true)
	})
})
