export namespace Prefetcher {
	export type Entry = {
		promise: Promise<Response>
		timeoutId: ReturnType<typeof setTimeout>
	}
}

export class Prefetcher {
	#cache = new Map<string, Prefetcher.Entry>()

	ttl = 60_000
	maxSize = 32

	constructor({ ttl = 60_000, maxSize = 32 }: { ttl?: number; maxSize?: number } = {}) {
		this.ttl = ttl
		this.maxSize = maxSize
	}

	/**
	 * Converts a url path to a cache key by normalising it
	 * against a base url
	 */
	static key(path: string, base: string) {
		try {
			const url = new URL(path, base)
			// hash is client-only and never sent to the server, so exclude it
			return url.pathname + url.search
		} catch {
			return null
		}
	}

	/**
	 * Evicts the oldest entry from the cache
	 */
	evict() {
		if (this.#cache.size === 0) return

		const candidate = this.#cache.entries().next().value
		if (!candidate) return

		const [key, entry] = candidate

		clearTimeout(entry.timeoutId)
		this.#cache.delete(key)
	}

	/**
	 * Returns a boolean indicating whether a cached response exists for the given path
	 */
	has(path: string) {
		return this.#cache.has(path)
	}

	/**
	 * Retrieves a fresh response promise for the given path if it exists
	 * by cloning the cached response so each consumer gets an unread stream
	 */
	get(path: string) {
		const promise = this.#cache.get(path)?.promise
		if (!promise) return

		return promise.then(res => res.clone())
	}

	/**
	 * Caches a response promise for the given path with a timeout to automatically
	 * clear the cache after a certain period (TTL_MS)
	 */
	set(path: string, promise: Promise<Response>) {
		const existing = this.#cache.get(path)

		if (existing) {
			clearTimeout(existing.timeoutId)
			this.#cache.delete(path)
		} else if (this.#cache.size >= this.maxSize) {
			this.evict()
		}

		const timeoutId = setTimeout(() => {
			const cached = this.#cache.get(path)
			if (!cached) return

			clearTimeout(cached.timeoutId)
			this.#cache.delete(path)
		}, this.ttl)

		this.#cache.set(path, { promise, timeoutId })
	}

	/**
	 * Removes the cached response for the given path and clears the associated timeout
	 */
	remove(path: string) {
		const cached = this.#cache.get(path)
		if (!cached) return

		clearTimeout(cached.timeoutId)
		this.#cache.delete(path)
	}

	/**
	 * Clears the entire cache and all associated timeouts
	 */
	clear() {
		for (const entry of this.#cache.values()) {
			clearTimeout(entry.timeoutId)
		}

		this.#cache.clear()
	}

	[Symbol.dispose]() {
		this.clear()
	}
}
