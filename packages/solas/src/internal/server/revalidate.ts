import * as Context from '../../utils/context.js'

export type RevalidatedPath = {
	path: string
	scope: 'page' | 'layout'
}

const RevalidationContext = Context.create<RevalidatedPath[]>('revalidation')

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

	RevalidationContext.use().push({ path: value, scope })
}

/**
 * Snapshot the paths invalidated for a Server Action response.
 */
export function getRevalidatedPaths() {
	return [...RevalidationContext.use()]
}
