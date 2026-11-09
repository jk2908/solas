import type { RscPayload } from '../env/rsc.js'

export type Prefetched = {
	payload: RscPayload
	url: string
}

namespace PrefetchCache {
	export type Entry = {
		promise: Promise<Prefetched | null>
		timeoutId: ReturnType<typeof setTimeout>
	}
}

/**
 * In-memory cache for parsed prefetched RSC payloads. Keeping the decoded
 * payload lets the prefetch response body finish loading before navigation.
 */
export class PrefetchCache {
	#cache = new Map<string, PrefetchCache.Entry>()

	ttl = 60_000
	maxSize = 32

	constructor({ ttl = 60_000, maxSize = 32 }: { ttl?: number; maxSize?: number } = {}) {
		this.ttl = ttl
		this.maxSize = maxSize
	}

	has(path: string) {
		return this.#cache.has(path)
	}

	get(path: string) {
		return this.#cache.get(path)?.promise
	}

	set(path: string, promise: Promise<Prefetched | null>) {
		const existing = this.#cache.get(path)

		if (existing) {
			clearTimeout(existing.timeoutId)
			this.#cache.delete(path)
		} else if (this.#cache.size >= this.maxSize) {
			const oldest = this.#cache.entries().next().value

			if (oldest) {
				clearTimeout(oldest[1].timeoutId)
				this.#cache.delete(oldest[0])
			}
		}

		const timeoutId = setTimeout(() => {
			const cached = this.#cache.get(path)
			if (!cached) return

			clearTimeout(cached.timeoutId)
			this.#cache.delete(path)
		}, this.ttl)

		this.#cache.set(path, { promise, timeoutId })
	}

	remove(path: string) {
		const cached = this.#cache.get(path)
		if (!cached) return

		clearTimeout(cached.timeoutId)
		this.#cache.delete(path)
	}

	clear() {
		for (const entry of this.#cache.values()) clearTimeout(entry.timeoutId)
		this.#cache.clear()
	}
}
