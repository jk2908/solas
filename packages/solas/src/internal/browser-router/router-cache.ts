import type { Route } from '../../types.js'
import type { RscPayload } from '../env/rsc.js'

export function isRouterCacheEntryType(
	value: string | null | undefined,
): value is RouterCache.Type {
	return value === 'full' || value === 'ppr' || value === 'dynamic'
}

export namespace RouterCache {
	export type Type = Route.PrerenderMode | 'dynamic'

	export type CachedPayload = {
		payload: RscPayload
		url: string
		bytes: number
	}

	export type DecodedStream = {
		payload: Promise<RscPayload>
		bytes: Promise<number>
		url: string
		type?: Type
	}

	export type DecodedResponse = {
		payload: RscPayload | null
		url: string
		bytes: number
		type: Type
	}

	type PendingEntry = {
		state: 'pending'
		response: Promise<DecodedStream | null>
		timer?: ReturnType<typeof setTimeout>
	}

	type ReadyEntry = {
		state: 'ready'
		type: Type
		value: CachedPayload
		timer?: ReturnType<typeof setTimeout>
	}

	export type Entry = PendingEntry | ReadyEntry
}

/**
 * In-memory client cache for route payloads. Fully prerendered entries are
 * held indefinitely for the lifetime of the document and evicted only when the
 * cache exceeds its byte budget. Dynamic entries expire after their TTL.
 */
export class RouterCache {
	#cache = new Map<string, RouterCache.Entry>()
	#bytes = 0

	maxBytes = 8 * 1024 * 1024
	ttl = 60_000

	constructor({
		maxBytes = 8 * 1024 * 1024,
		ttl = 60_000,
	}: { maxBytes?: number; ttl?: number } = {}) {
		this.maxBytes = maxBytes
		this.ttl = ttl
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

	set(key: string, response: Promise<RouterCache.DecodedStream | null>) {
		this.#delete(key)

		const entry: RouterCache.Entry = { state: 'pending', response }
		this.#cache.set(key, entry)

		void response.then(
			stream => {
				if (this.#cache.get(key) !== entry) return

				if (!stream) {
					this.#delete(key)
					return
				}

				void Promise.all([stream.payload, stream.bytes]).then(
					([payload, bytes]) => {
						if (this.#cache.get(key) !== entry) return

						const type =
							stream.type ?? payload.type ?? ('dynamic' satisfies RouterCache.Type)
						const ready: RouterCache.Entry = {
							state: 'ready',
							type,
							value: {
								payload,
								url: stream.url,
								bytes,
							},
							timer: this.#timer(key, type),
						}

						this.#cache.set(key, ready)
						this.#bytes += ready.value.bytes
						this.#evict(key)
					},
					() => {
						if (this.#cache.get(key) === entry) this.#delete(key)
					},
				)
			},
			() => {
				if (this.#cache.get(key) === entry) this.#delete(key)
			},
		)
	}

	setReady(key: string, type: RouterCache.Type, value: RouterCache.CachedPayload) {
		this.#delete(key)

		const ready: RouterCache.Entry = {
			state: 'ready',
			type,
			value,
			timer: this.#timer(key, type),
		}
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

	#timer(key: string, type: RouterCache.Type) {
		if (type === 'full') return

		return setTimeout(() => this.#delete(key), this.ttl)
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
