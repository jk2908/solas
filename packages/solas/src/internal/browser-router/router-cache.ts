import type { Route } from '../../types.js'
import type { RscPayload } from '../env/rsc.js'
import type { SegmentMeta } from './segment-slot.js'

export function isRouterCacheEntryType(
	value: string | null | undefined,
): value is RouterCache.Type {
	return value === 'full' || value === 'ppr' || value === 'dynamic'
}

export namespace RouterCache {
	export type Type = Route.PrerenderMode | 'dynamic'
	export type SegmentType = 'static' | 'dynamic'

	export type CachedPayload = {
		payload: RscPayload
		url: string
		bytes: number
		meta?: Map<string, SegmentMeta>
	}

	export type CachedSegment = CachedPayload

	export type DecodedStream = {
		payload: Promise<RscPayload>
		bytes: Promise<number>
		url: string
		type?: Type
	}

	type PendingEntry = {
		kind: 'route'
		status: 'pending'
		response: Promise<DecodedStream | null>
	}

	type ReadyEntry = {
		kind: 'route'
		status: 'ready'
		type: Type
		value: CachedPayload
		timer?: ReturnType<typeof setTimeout>
	}

	type SegmentEntry = {
		kind: 'segment'
		status: 'ready'
		type: SegmentType
		value: CachedSegment
		timer?: ReturnType<typeof setTimeout>
	}

	export type Entry = PendingEntry | ReadyEntry | SegmentEntry
}

/**
 * In-memory client cache for route payloads. Fully prerendered entries are
 * held indefinitely for the lifetime of the document and evicted only when the
 * cache exceeds its byte budget. Dynamic entries expire after their TTL.
 */
export class RouterCache {
	#cache = new Map<string, RouterCache.Entry>()
	#bytes = 0

	enabled = true
	maxBytes = 8 * 1024 * 1024
	ttl = 60_000

	constructor({
		enabled = true,
		maxBytes = 8 * 1024 * 1024,
		ttl = 60_000,
	}: { enabled?: boolean; maxBytes?: number; ttl?: number } = {}) {
		this.enabled = enabled
		this.maxBytes = maxBytes
		this.ttl = ttl
	}

	has(key: string) {
		return this.enabled && this.#cache.has(this.#routeKey(key))
	}

	get(key: string) {
		if (!this.enabled) return

		const entry = this.#cache.get(this.#routeKey(key))
		if (!entry || entry.kind !== 'route') return

		if (entry.status === 'ready') {
			// refresh the LRU position for ready entries
			this.#cache.delete(this.#routeKey(key))
			this.#cache.set(this.#routeKey(key), entry)
		}

		return entry
	}

	set(key: string, response: Promise<RouterCache.DecodedStream | null>) {
		if (!this.enabled) return

		const cacheKey = this.#routeKey(key)
		this.#delete(cacheKey)

		const entry: RouterCache.Entry = { kind: 'route', status: 'pending', response }
		this.#cache.set(cacheKey, entry)

		void response.then(
			stream => {
				if (this.#cache.get(cacheKey) !== entry) return

				if (!stream) {
					this.#delete(cacheKey)
					return
				}

				void Promise.all([stream.payload, stream.bytes]).then(
					([payload, bytes]) => {
						if (this.#cache.get(cacheKey) !== entry) return

						const type =
							stream.type ?? payload.type ?? ('dynamic' satisfies RouterCache.Type)

						const ready: RouterCache.Entry = {
							kind: 'route',
							status: 'ready',
							type,
							value: {
								payload,
								url: stream.url,
								bytes,
							},
							timer: this.#timer(cacheKey, type),
						}

						this.#cache.set(cacheKey, ready)
						this.#bytes += ready.value.bytes

						this.#evict(cacheKey)
					},
					() => {
						if (this.#cache.get(cacheKey) === entry) this.#delete(cacheKey)
					},
				)
			},
			() => {
				if (this.#cache.get(cacheKey) === entry) this.#delete(cacheKey)
			},
		)
	}

	setReady(key: string, type: RouterCache.Type, value: RouterCache.CachedPayload) {
		if (!this.enabled) return

		const cacheKey = this.#routeKey(key)
		this.#delete(cacheKey)

		const ready: RouterCache.Entry = {
			kind: 'route',
			status: 'ready',
			type,
			value,
			timer: this.#timer(cacheKey, type),
		}

		this.#cache.set(cacheKey, ready)
		this.#bytes += value.bytes
		this.#evict(cacheKey)
	}

	getSegment(key: string) {
		if (!this.enabled) return

		const cacheKey = this.#segmentKey(key)
		const entry = this.#cache.get(cacheKey)
		if (!entry || entry.kind !== 'segment') return

		this.#cache.delete(cacheKey)
		this.#cache.set(cacheKey, entry)

		return entry
	}

	hasSegment(key: string) {
		if (!this.enabled) return false

		const entry = this.#cache.get(this.#segmentKey(key))
		return entry?.kind === 'segment'
	}

	setSegment(
		key: string,
		type: RouterCache.SegmentType,
		value: RouterCache.CachedSegment,
		options?: { ttl?: number | null },
	) {
		if (!this.enabled) return

		const cacheKey = this.#segmentKey(key)
		this.#delete(cacheKey)

		const entry: RouterCache.Entry = {
			kind: 'segment',
			status: 'ready',
			type,
			value,
			timer: this.#timer(cacheKey, type, options?.ttl),
		}

		this.#cache.set(cacheKey, entry)
		this.#bytes += value.bytes
		this.#evict(cacheKey)
	}

	removeSegment(key: string) {
		if (!this.enabled) return
		this.#delete(this.#segmentKey(key))
	}

	invalidatePath(path: string, scope: 'page' | 'layout' = 'page') {
		if (!this.enabled) return

		const target = path.split('?')[0] || '/'

		for (const [key, entry] of this.#cache) {
			if (
				entry.kind !== 'segment' &&
				!(entry.kind === 'route' && entry.status === 'ready')
			) {
				continue
			}

			const keyMatches =
				key === this.#routeKey(target) ||
				key === this.#segmentKey(target) ||
				(scope === 'layout' &&
					(key.startsWith(`route:${target}/`) || key.startsWith(`segment:${target}/`)))

			if (keyMatches) this.#delete(key)
		}
	}

	remove(key: string) {
		if (!this.enabled) return
		this.#delete(this.#routeKey(key))
	}

	clear() {
		for (const entry of this.#cache.values()) {
			if (entry.status === 'ready' && entry.timer !== undefined) {
				clearTimeout(entry.timer)
			}
		}

		this.#cache.clear()
		this.#bytes = 0
	}

	#routeKey(key: string) {
		return `route:${key}`
	}

	#segmentKey(key: string) {
		return `segment:${key}`
	}

	#timer(
		key: string,
		type: RouterCache.Type | RouterCache.SegmentType,
		ttl?: number | null,
	) {
		if (type !== 'dynamic') return
		if (ttl === null) return
		return setTimeout(() => this.#delete(key), ttl ?? this.ttl)
	}

	#evict(evictionKey: string) {
		if (this.#bytes <= this.maxBytes) return

		for (const [key, entry] of this.#cache) {
			if (this.#bytes <= this.maxBytes) break
			if (key === evictionKey || entry.status !== 'ready') continue

			this.#delete(key)
		}
	}

	#delete(key: string) {
		const entry = this.#cache.get(key)
		if (!entry) return

		if (entry.status === 'ready') {
			if (entry.timer !== undefined) clearTimeout(entry.timer)
			this.#bytes -= entry.value.bytes
		}

		this.#cache.delete(key)
	}
}
