import * as Context from '../../utils/context.js'
import { ErrorCode, SolasError } from '../../utils/errors.js'

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

	const paths = RevalidationContext.get()

	if (!paths) {
		throw new SolasError(
			ErrorCode.RevalidateOutsideAction,
			'revalidatePath() can only be called from a Server Action',
			{ hint: 'Call revalidatePath() inside a function marked with "use server".' },
		)
	}

	paths.push({ path: value, scope })
}

/**
 * Snapshot the paths invalidated for a Server Action response.
 */
export function getRevalidatedPaths() {
	return [...RevalidationContext.use()]
}
