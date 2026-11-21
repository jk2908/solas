const invalidatedPaths: RevalidatedPath[] = []

export type RevalidatedPath = {
	path: string
	scope: 'page' | 'layout'
}

/**
 * Invalidate route/segment caches for a path.
 */
export function revalidatePath(path: string, scope: 'page' | 'layout' = 'page') {
	if (!path) return

	invalidatedPaths.push({
		path: path.split('?')[0] || '/',
		scope,
	})
}

/**
 * Drain paths invalidated during the current action request.
 */
export function drainRevalidatedPaths() {
	const paths = [...invalidatedPaths]
	invalidatedPaths.length = 0
	return paths
}
