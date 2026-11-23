import * as Context from '../../utils/context.js'

export type RevalidatedPath = {
	path: string
	scope: 'page' | 'layout'
}

const RevalidationContext = Context.create<RevalidatedPath[]>('revalidation')

/**
 * Run a request with its own invalidation list.
 */
export function runWithRevalidations<T>(fn: (paths: RevalidatedPath[]) => T): T {
	const paths: RevalidatedPath[] = []
	return RevalidationContext.write(paths, () => fn(paths))
}

/**
 * Invalidate route/segment caches for a path.
 */
export function revalidatePath(path: string, scope: 'page' | 'layout' = 'page') {
	if (!path) return

	const paths = RevalidationContext.get()

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
	const paths = RevalidationContext.get()
	if (!paths) return []

	return paths.splice(0)
}
