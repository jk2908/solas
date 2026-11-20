const invalidatedTags = new Set<string>()
const invalidatedPaths: RevalidatedPath[] = []

export type RevalidatedPath = {
	path: string
	scope: 'page' | 'layout'
}

/**
 * Mark cached segment data as stale.
 */
export function revalidateTag(tag: string) {
	if (tag) invalidatedTags.add(tag)
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
 * Drain tags invalidated during the current action request.
 */
export function drainRevalidatedTags() {
	const tags = [...invalidatedTags]
	invalidatedTags.clear()
	return tags
}

/**
 * Drain paths invalidated during the current action request.
 */
export function drainRevalidatedPaths() {
	const paths = [...invalidatedPaths]
	invalidatedPaths.length = 0
	return paths
}
