export namespace Preload {
	type Entry = {
		promise: Promise<Response>
		timeoutId: ReturnType<typeof setTimeout>
	}

	const TTL_MS = 60_000
	const cache = new Map<string, Entry>()

	/**
	 * Converts a url path to a cache key by normalising it
	 * against a base url
	 * @param path - the url path to convert
	 * @param base - the base url to resolve against (defaults to http://localhost)
	 * @returns the cache key
	 */
	export function toKey(path: string, base: string) {
		const url = new URL(path, base)
		return url.pathname + url.search + url.hash
	}

	/**
	 * Returns a boolean indicating whether a cached response exists for the given path
	 * @param path - the url path to check in the cache
	 * @returns true if a cached response exists for the path, false otherwise
	 */
	export function has(path: string) {
		return cache.has(path)
	}

	/**
	 * Retrieves the cached response promise for the given path if it exists
	 * @param path - the url path to retrieve from the cache
	 * @returns the cached response promise or undefined if not found
	 */
	export function get(path: string) {
		return cache.get(path)?.promise
	}

	/**
	 * Caches a response promise for the given path with a timeout to automatically
	 * clear the cache after a certain period (TTL_MS)
	 * @param path - the url path to cache
	 * @param promise - the response promise to cache
	 * @return void
	 */
	export function set(path: string, promise: Promise<Response>) {
		const existing = cache.get(path)

		if (existing) {
			clearTimeout(existing.timeoutId)
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
	 * @param path - the url path to remove from the cache
	 * @returns void
	 */
	export function remove(path: string) {
		const cached = cache.get(path)
		if (!cached) return

		clearTimeout(cached.timeoutId)
		cache.delete(path)
	}
}
