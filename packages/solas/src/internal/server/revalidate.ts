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
	const value = path.trim().split(/[?#]/)[0]
	if (!value) return

	const paths = RevalidationContext.get()

	if (!paths) {
		throw new Error('revalidatePath must be called during a request')
	}

	paths.push({ path: value, scope })
}

/**
 * Take and clear paths invalidated during the current request.
 */
export function takeRevalidatedPaths() {
	const paths = RevalidationContext.get()

	if (!paths) {
		throw new Error('takeRevalidatedPaths must be called during a request')
	}

	return paths.splice(0)
}
