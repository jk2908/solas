export namespace Prefetch {
	type Entry = {
		promise: Promise<Response>
		timeoutId: ReturnType<typeof setTimeout>
	}

	export const TTL_MS = 60_000
	const MAX_SIZE = 32
	const cache = new Map<string, Entry>()

	function evict(mode: 'oldest' | 'random' = 'oldest') {
		if (cache.size === 0) return

		const candidate =
			mode === 'oldest'
				? [...cache.entries()].reduce((oldest, entry) =>
						entry[1].promise < oldest[1].promise ? entry : oldest,
					)
				: [...cache.entries()][Math.floor(Math.random() * cache.size)]

		if (!candidate) return
		const [key, entry] = candidate

		clearTimeout(entry.timeoutId)
		cache.delete(key)
	}

	/**
	 * Converts a url path to a cache key by normalising it
	 * against a base url
	 */
	export function toKey(path: string, base: string) {
		const url = new URL(path, base)
		return url.pathname + url.search + url.hash
	}

	/**
	 * Returns a boolean indicating whether a cached response exists for the given path
	 */
	export function has(path: string) {
		return cache.has(path)
	}

	/**
	 * Retrieves a fresh response promise for the given path if it exists
	 * by cloning the cached response so each consumer gets an unread stream
	 */
	export function get(path: string) {
		const promise = cache.get(path)?.promise
		if (!promise) return undefined

		return promise.then(response => response.clone())
	}

	/**
	 * Caches a response promise for the given path with a timeout to automatically
	 * clear the cache after a certain period (TTL_MS)
	 */
	export function set(path: string, promise: Promise<Response>) {
		const existing = cache.get(path)

		if (existing) {
			clearTimeout(existing.timeoutId)
			cache.delete(path)
		} else if (cache.size >= MAX_SIZE) {
			evict()
		}

		const timeoutId = setTimeout(() => {
			const cached = cache.get(path)
			if (!cached) return

			clearTimeout(cached.timeoutId)
			cache.delete(path)
		}, TTL_MS)

		cache.set(path, { promise, timeoutId })
	}

	/**
	 * Removes the cached response for the given path and clears the associated timeout
	 */
	export function remove(path: string) {
		const cached = cache.get(path)
		if (!cached) return

		clearTimeout(cached.timeoutId)
		cache.delete(path)
	}
}
