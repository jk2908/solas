import { describe, expect, it, vi } from 'vitest'

import type {
	CachedPayload,
	DecodedResponse,
} from '../../../../src/internal/browser-router/router-cache.js'
import { RouterCache } from '../../../../src/internal/browser-router/router-cache.js'

function cached(path: string, bytes: number): CachedPayload {
	return {
		payload: { root: null, url: { pathname: path } },
		url: path,
		bytes,
	}
}

function decoded(path: string, bytes: number): DecodedResponse {
	return {
		payload: { root: null, url: { pathname: path } },
		url: path,
		bytes,
		type: 'full',
	}
}

describe('RouterCache', () => {
	it('promotes a pending entry to ready', async () => {
		const cache = new RouterCache()
		const promise = Promise.resolve(decoded('/about', 10))

		cache.set('/about', promise)
		expect(cache.get('/about')?.state).toBe('pending')

		await promise
		await Promise.resolve()

		const entry = cache.get('/about')
		expect(entry?.state).toBe('ready')
		if (entry?.state !== 'ready') throw new Error('expected ready entry')
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

		expect(cache.get('/about')?.state).toBe('ready')
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

		cache.set('/a', Promise.resolve(decoded('/a', 60)))
		cache.set('/b', Promise.resolve(decoded('/b', 40)))
		await Promise.resolve()
		await Promise.resolve()

		cache.get('/a')
		cache.set('/c', Promise.resolve(decoded('/c', 60)))
		await Promise.resolve()
		await Promise.resolve()

		expect(cache.has('/a')).toBe(true)
		expect(cache.has('/b')).toBe(false)
		expect(cache.has('/c')).toBe(true)
	})

	it('clears all entries and resets the byte count', async () => {
		const cache = new RouterCache()
		cache.set('/about', Promise.resolve(decoded('/about', 10)))
		await Promise.resolve()
		await Promise.resolve()

		cache.clear()

		expect(cache.has('/about')).toBe(false)
	})
})
