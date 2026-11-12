import { describe, expect, it } from 'vitest'

import type { CachedPayload } from '../../../../src/internal/browser-router/router-cache.js'
import { RouterCache } from '../../../../src/internal/browser-router/router-cache.js'

function payload(path: string, bytes: number): CachedPayload {
	return {
		payload: { root: null, url: { pathname: path } },
		url: path,
		bytes,
	}
}

describe('RouterCache', () => {
	it('promotes a pending entry to ready', async () => {
		const cache = new RouterCache()
		const promise = Promise.resolve(payload('/about', 10))

		cache.set('/about', 'full', promise)
		expect(cache.get('/about')?.state).toBe('pending')

		await promise
		await Promise.resolve()

		const entry = cache.get('/about')
		expect(entry?.state).toBe('ready')
		if (entry?.state !== 'ready') throw new Error('expected ready entry')
		expect(entry.value.payload.url.pathname).toBe('/about')
		expect(entry.value.bytes).toBe(10)
	})

	it('removes an entry when the promise resolves without a payload', async () => {
		const cache = new RouterCache()
		const promise = Promise.resolve(null)

		cache.set('/about', 'full', promise)
		await promise
		await Promise.resolve()

		expect(cache.has('/about')).toBe(false)
	})

	it('evicts LRU entries when the byte budget is exceeded', async () => {
		const cache = new RouterCache({ maxBytes: 120 })

		cache.set('/a', 'full', Promise.resolve(payload('/a', 60)))
		cache.set('/b', 'full', Promise.resolve(payload('/b', 40)))
		await Promise.resolve()
		await Promise.resolve()

		cache.get('/a')
		cache.set('/c', 'full', Promise.resolve(payload('/c', 60)))
		await Promise.resolve()
		await Promise.resolve()

		expect(cache.has('/a')).toBe(true)
		expect(cache.has('/b')).toBe(false)
		expect(cache.has('/c')).toBe(true)
	})

	it('clears all entries and resets the byte count', async () => {
		const cache = new RouterCache()
		cache.set('/about', 'full', Promise.resolve(payload('/about', 10)))
		await Promise.resolve()
		await Promise.resolve()

		cache.clear()

		expect(cache.has('/about')).toBe(false)
	})
})
