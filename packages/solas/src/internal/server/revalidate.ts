import * as Context from '../../utils/context.js'

export type RevalidatedPath = {
	path: string
	scope: 'page' | 'layout'
}

const RevalidationContext = Context.create<RevalidatedPath[]>('revalidation')
const listeners = new Set<(paths: RevalidatedPath[]) => void>()

/**
 * Run a request with its own invalidation list.
 */
export function withRevalidations<T>(fn: () => T): T {
	return RevalidationContext.write([], fn)
}

/**
 * Invalidate route/segment caches for a path.
 */
export function revalidatePath(path: string, scope: 'page' | 'layout' = 'page') {
	// cache keys never include the query string or hash
	const value = path.trim().split(/[?#]/)[0]
	if (!value) return

	const paths = RevalidationContext.get()

	if (!paths) {
		throw new Error('revalidatePath must be called during a request')
	}

	paths.push({ path: value, scope })
}

/**
 * Subscribe to invalidations published to connected clients.
 */
export function subscribeRevalidations(listener: (paths: RevalidatedPath[]) => void) {
	listeners.add(listener)
	return () => listeners.delete(listener)
}

/**
 * Publish request invalidations to connected clients.
 */
export function publishRevalidations(paths: RevalidatedPath[]) {
	if (paths.length === 0) return

	for (const listener of listeners) listener(paths)
}

/**
 * Snapshot the paths invalidated for a Server Action response.
 */
export function getRevalidatedPaths() {
	const paths = RevalidationContext.get()

	if (!paths) {
		throw new Error('getRevalidatedPaths must be called during a request')
	}

	return [...paths]
}
