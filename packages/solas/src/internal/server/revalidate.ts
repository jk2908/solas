import { AsyncLocalStorage } from 'node:async_hooks'

export type RevalidatedPath = {
	path: string
	scope: 'page' | 'layout'
}

const storage = new AsyncLocalStorage<RevalidatedPath[]>()

/**
 * Run a request with its own invalidation list.
 */
export function runWithRevalidations<T>(fn: (paths: RevalidatedPath[]) => T): T {
	const paths: RevalidatedPath[] = []
	return storage.run(paths, () => fn(paths))
}

/**
 * Invalidate route/segment caches for a path.
 */
export function revalidatePath(path: string, scope: 'page' | 'layout' = 'page') {
	if (!path) return

	const paths = storage.getStore()

	if (!paths) {
		throw new Error('revalidatePath must be called during a request')
	}

	paths.push({
		path: path.split('?')[0] || '/',
		scope,
	})
}

/**
 * Drain paths invalidated during the current request.
 */
export function drainRevalidatedPaths() {
	const paths = storage.getStore()
	if (!paths) return []

	return paths.splice(0)
}
