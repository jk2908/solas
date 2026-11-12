import type { Route } from '../../types.js'
import type { RscPayload } from '../env/rsc.js'

export type RouterCacheType = Route.PrerenderMode | 'dynamic'

export type CachedPayload = {
	payload: RscPayload
	url: string
	bytes: number
}

export type DecodedResponse = {
	payload: RscPayload | null
	url: string
	bytes: number
	type: RouterCacheType
}

type PendingEntry = {
	state: 'pending'
	type?: RouterCacheType
	promise: Promise<DecodedResponse | null>
	timer?: ReturnType<typeof setTimeout>
}

type ReadyEntry = {
	state: 'ready'
	type: RouterCacheType
	value: CachedPayload
	timer?: ReturnType<typeof setTimeout>
}

type NegativeEntry = {
	state: 'negative'
	type: RouterCacheType
	timer: ReturnType<typeof setTimeout>
}

export type RouterCacheEntry = PendingEntry | ReadyEntry | NegativeEntry

/**
 * In-memory client cache for route payloads. Fully prerendered entries are
 * held indefinitely for the lifetime of the document and evicted only when the
 * cache exceeds its byte budget.
 */
export class RouterCache {
	#cache = new Map<string, RouterCacheEntry>()
	#bytes = 0

	maxBytes = 8 * 1024 * 1024
	negativeTtl = 60_000

	constructor({
		maxBytes = 8 * 1024 * 1024,
		negativeTtl = 60_000,
	}: { maxBytes?: number; negativeTtl?: number } = {}) {
		this.maxBytes = maxBytes
		this.negativeTtl = negativeTtl
	}

	has(key: string) {
		return this.#cache.has(key)
	}

	get(key: string) {
		const entry = this.#cache.get(key)
		if (!entry) return

		if (entry.state === 'ready') {
			// refresh the LRU position for ready entries
			this.#cache.delete(key)
			this.#cache.set(key, entry)
		}

		return entry
	}

	set(key: string, promise: Promise<DecodedResponse | null>) {
		this.#delete(key)

		const entry: PendingEntry = { state: 'pending', promise }
		this.#cache.set(key, entry)

		void promise.then(
			value => {
				if (this.#cache.get(key) !== entry) return

				if (!value) {
					this.#delete(key)
					return
				}

				if (!value.payload) {
					const timer = setTimeout(() => this.#delete(key), this.negativeTtl)
					this.#cache.set(key, {
						state: 'negative',
						type: value.type,
						timer,
					})
					return
				}

				const ready: ReadyEntry = {
					state: 'ready',
					type: value.type,
					value: {
						payload: value.payload,
						url: value.url,
						bytes: value.bytes,
					},
				}
				this.#cache.set(key, ready)
				this.#bytes += ready.value.bytes
				this.#evict(key)
			},
			() => {
				if (this.#cache.get(key) === entry) this.#delete(key)
			},
		)
	}

	setReady(key: string, type: RouterCacheType, value: CachedPayload) {
		this.#delete(key)

		const ready: ReadyEntry = { state: 'ready', type, value }
		this.#cache.set(key, ready)
		this.#bytes += value.bytes
		this.#evict(key)
	}

	remove(key: string) {
		this.#delete(key)
	}

	clear() {
		for (const entry of this.#cache.values()) {
			if (entry.timer !== undefined) clearTimeout(entry.timer)
		}

		this.#cache.clear()
		this.#bytes = 0
	}

	#evict(currentKey: string) {
		if (this.#bytes <= this.maxBytes) return

		for (const [key, entry] of this.#cache) {
			if (this.#bytes <= this.maxBytes) break
			if (key === currentKey || entry.state !== 'ready') continue

			this.#delete(key)
		}
	}

	#delete(key: string) {
		const entry = this.#cache.get(key)
		if (!entry) return

		if (entry.timer !== undefined) clearTimeout(entry.timer)
		if (entry.state === 'ready') this.#bytes -= entry.value.bytes

		this.#cache.delete(key)
	}
}
