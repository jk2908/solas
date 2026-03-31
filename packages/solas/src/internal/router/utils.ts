import type { Route } from '../../types'

export type PathPattern = {
	path: string
	wildcardNames: Set<string>
}

function escapePathSegment(value: string) {
	return value.replace(/[\\.+*?^${}()[\]|!:]/g, '\\$&')
}

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

export function normalisePathname(
	pathname: string,
	trailingSlash: Route.TrailingSlash = 'never',
) {
	if (pathname === '/') return pathname
	if (trailingSlash === 'ignore') return pathname
	if (trailingSlash === 'always')
		return pathname.endsWith('/') ? pathname : `${pathname}/`

	return pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
}

export function alternatePathname(pathname: string) {
	if (pathname === '/') return pathname
	return pathname.endsWith('/') ? pathname.slice(0, -1) : `${pathname}/`
}
