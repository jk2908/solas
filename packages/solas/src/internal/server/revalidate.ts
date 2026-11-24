import * as Context from '../../utils/context.js'

export type RevalidatedPath = {
	path: string
	scope: 'page' | 'layout'
}

type RevalidationState = {
	paths: RevalidatedPath[]
	enabled: boolean
}

const RevalidationContext = Context.create<RevalidationState>('revalidation')

/**
 * Run a request with its own invalidation list.
 */
export function withRevalidations<T>(fn: () => T): T {
	return RevalidationContext.write({ paths: [], enabled: false }, fn)
}

/**
 * Enable revalidation for a Server Action request.
 */
export function enableRevalidations() {
	RevalidationContext.use().enabled = true
}

/**
 * Invalidate route/segment caches for a path.
 */
export function revalidatePath(path: string, scope: 'page' | 'layout' = 'page') {
	// cache keys never include the query string or hash
	const value = path.trim().split(/[?#]/)[0]
	if (!value) return

	const state = RevalidationContext.use()

	if (!state.enabled) {
		throw new Error('revalidatePath can only be called from a Server Action')
	}

	state.paths.push({ path: value, scope })
}

/**
 * Snapshot the paths invalidated for a Server Action response.
 */
export function getRevalidatedPaths() {
	return [...RevalidationContext.use().paths]
}
