import type { ReactNode } from 'react'

import { layoutSegmentKey, type LayoutCacheParams } from './layout-cache-key.js'

type Entry = {
	id: string
	value: ReactNode
	expiresAt: number
	path?: string
}

/**
 * Client-side cache for independently rendered layout nodes.
 *
 * Layouts are keyed by their segment ID and route params, so the same node can
 * be reused across routes without being tied to a single URL.
 */
export class LayoutCache {
	#entries = new Map<string, Entry>()

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

		return entry
	}

	/**
	 * Read several layout nodes and report whether any are missing or stale.
	 */
	getValues(ids: string[], params?: LayoutCacheParams) {
		const values = new Map<string, ReactNode>()
		let missing = false

		for (const id of ids) {
			const entry = this.get(id, params)

			if (!entry) {
				missing = true
				continue
			}

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
		this.#entries.set(layoutSegmentKey(id, params), {
			id,
			value,
			expiresAt: options.expiresAt,
			path: options.path,
		})
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
			if (!entry.path || entry.path === path || entry.path.startsWith(`${path}/`)) {
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
}
