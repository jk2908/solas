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

function stream(path: string, bytes: number): RouterCache.DecodedStream {
	return {
		payload: Promise.resolve({ root: null, url: { pathname: path } }),
		bytes: Promise.resolve(bytes),
		url: path,
		type: 'full',
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
		const cache = new RouterCache({ ttl: 1000 })
		cache.setReady('/dynamic', 'dynamic', cached('/dynamic', 10))

		vi.advanceTimersByTime(999)
		expect(cache.has('/dynamic')).toBe(true)
		vi.advanceTimersByTime(1)
		expect(cache.has('/dynamic')).toBe(false)
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
})
