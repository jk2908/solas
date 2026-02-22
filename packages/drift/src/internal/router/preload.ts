export namespace Preload {
	type Entry = {
		promise: Promise<Response>
		timeoutId: ReturnType<typeof setTimeout>
	}

	const TTL_MS = 60_000
	const cache = new Map<string, Entry>()

	export function toKey(path: string, base: string) {
		const url = new URL(path, base)
		return url.pathname + url.search + url.hash
	}

	export function has(path: string) {
		return cache.has(path)
	}

	export function get(path: string) {
		return cache.get(path)?.promise
	}

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

	export function remove(path: string) {
		const cached = cache.get(path)
		if (!cached) return

		clearTimeout(cached.timeoutId)
		cache.delete(path)
	}
}
