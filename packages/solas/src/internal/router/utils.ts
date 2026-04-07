import type { Route } from '../../types.js'

export type PathPattern = {
	path: string
	wildcardNames: Set<string>
}

/**
 * Escape a literal path segment so it can be used safely in a
 * path-to-regexp pattern
 */
function escapePathSegment(value: string) {
	return value.replace(/[\\.+*?^${}()[\]|!:]/g, '\\$&')
}

/**
 * Convert an internal route string into a path-to-regexp pattern and collect
 * the wildcard param names used in that pattern
 */
export function toPathPattern(route: string, paramNames: string[] = []) {
	if (route === '/') {
		return { path: route, wildcardNames: new Set<string>() }
	}

	let paramIndex = 0
	let wildcardIndex = 0
	const wildcardNames = new Set<string>()

	const path = route
		.split('/')
		.filter(Boolean)
		.map(segment => {
			if (segment.startsWith(':')) {
				paramIndex += 1
				return `/${segment}`
			}

			if (segment === '*') {
				// reuse the discovered param name when we have one so wildcard params
				// line up with the generated route pattern
				const value = paramNames[paramIndex]
				const name = value && value !== '*' ? value : `wildcard${wildcardIndex}`

				paramIndex += 1
				wildcardIndex += 1
				wildcardNames.add(name)

				return `/*${name}`
			}

			return `/${escapePathSegment(segment)}`
		})
		.join('')

	return { path: path || '/', wildcardNames }
}

/**
 * Apply the configured trailing-slash policy to a pathname
 */
export function normalisePathname(
	pathname: string,
	trailingSlash: Route.TrailingSlash = 'never',
) {
	if (pathname === '/') return pathname
	// ignore mode keeps the incoming pathname shape as-is
	if (trailingSlash === 'ignore') return pathname
	if (trailingSlash === 'always')
		return pathname.endsWith('/') ? pathname : `${pathname}/`

	return pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
}

/**
 * Return the other pathname shape for a non-root route
 */
export function getAlternatePathname(pathname: string) {
	if (pathname === '/') return pathname
	return pathname.endsWith('/') ? pathname.slice(0, -1) : `${pathname}/`
}
