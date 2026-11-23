import type { ReactNode } from 'react'

import { layoutSegmentKey, type LayoutCacheParams } from './layout-cache-key.js'

type Entry = {
	id: string
	value: ReactNode
	expiresAt: number
	paths: Set<string>
}

type LayoutCacheOptions = {
	maxEntries?: number
}

const MAX_TRACKED_PATHS = 32

/**
 * Client-side cache for independently rendered layout nodes.
 *
 * Layouts are keyed by their segment ID and route params, so the same node can
 * be reused across routes without being tied to a single URL.
 */
export class LayoutCache {
	#entries = new Map<string, Entry>()
	maxEntries: number

	constructor({ maxEntries = 100 }: LayoutCacheOptions = {}) {
		this.maxEntries = maxEntries
	}

	/**
	 * Read a live layout node.
	 */
	get(id: string, params?: LayoutCacheParams) {
		const key = layoutSegmentKey(id, params)
		const entry = this.#entries.get(key)

		if (!entry) return undefined

		if (entry.expiresAt <= Date.now()) {
			this.#entries.delete(key)
			return undefined
		}

		// refresh the LRU position
		this.#entries.delete(key)
		this.#entries.set(key, entry)

		return entry
	}

	/**
	 * Read several layout nodes and report whether any are missing or stale.
	 */
	getValues(ids: string[], params?: LayoutCacheParams, path?: string) {
		const values = new Map<string, ReactNode>()
		let missing = false

		for (const id of ids) {
			const entry = this.get(id, params)

			if (!entry) {
				missing = true
				continue
			}

			if (path) this.#addPath(entry, path)
			values.set(id, entry.value)
		}

		return { values, missing }
	}

	/**
	 * Store a layout node and its cache policy.
	 */
	set(
		id: string,
		params: LayoutCacheParams | undefined,
		value: ReactNode,
		options: { expiresAt: number; path?: string },
	) {
		const key = layoutSegmentKey(id, params)
		const paths = this.#entries.get(key)?.paths ?? new Set<string>()

		const entry = {
			id,
			value,
			expiresAt: options.expiresAt,
			paths,
		}

		if (options.path) this.#addPath(entry, options.path)

		this.#entries.delete(key)
		this.#entries.set(key, entry)

		this.#trim()
	}

	/**
	 * Record that a cached layout was reused for another path.
	 */
	touch(id: string, params: LayoutCacheParams | undefined, path: string) {
		const entry = this.get(id, params)
		if (entry) this.#addPath(entry, path)
	}

	/**
	 * Return the IDs currently held by the cache.
	 */
	ids() {
		const now = Date.now()

		for (const [key, entry] of this.#entries) {
			if (entry.expiresAt <= now) this.#entries.delete(key)
		}

		return [...new Set([...this.#entries.values()].map(entry => entry.id))]
	}

	/**
	 * Drop layouts from a path. Layout scope also drops descendants.
	 */
	invalidatePath(path: string, scope: 'page' | 'layout') {
		if (scope === 'page') return

		for (const [key, entry] of this.#entries) {
			if (
				entry.paths.size === 0 ||
				entry.paths.has('*') ||
				[...entry.paths].some(item => isPathWithin(item, path))
			) {
				this.#entries.delete(key)
			}
		}
	}

	/**
	 * Drop everything. Used by HMR, refresh, and full invalidation.
	 */
	clear() {
		this.#entries.clear()
	}

	#addPath(entry: Entry, path: string) {
		if (entry.paths.has(path) || entry.paths.has('*')) return

		if (entry.paths.size >= MAX_TRACKED_PATHS) {
			entry.paths.clear()
			entry.paths.add('*')
			return
		}

		entry.paths.add(path)
	}

	#trim() {
		while (this.#entries.size > this.maxEntries) {
			const oldest = this.#entries.keys().next().value
			if (oldest === undefined) return
			this.#entries.delete(oldest)
		}
	}
}

/**
 * Whether a path belongs to another path or one of its descendants.
 */
function isPathWithin(candidate: string, path: string) {
	return candidate === path || path === '/' || candidate.startsWith(`${path}/`)
}
