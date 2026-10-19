import { applyBasePath, stripBasePath } from '../../utils/base-path.js'

import type { PluginConfig } from '../../types.js'

/**
 * Whether a request wants the RSC payload rather than a document.
 *
 * The client asks for `text/x-component` on navigations. Anything else (a
 * browser, or a fetch with no explicit preference) should get HTML, so a plain
 * request to a page never receives the RSC payload.
 */
export function isRscRequest(req: Request) {
	const accept = req.headers.get('accept') ?? ''

	return accept.includes('text/x-component') && !accept.includes('text/html')
}

export type PathPattern = {
	path: string
	wildcardNames: Set<string>
}

/**
 * Resolve an incoming request pathname against the base path and trailing-slash
 * policy. Both the dispatch layer and the router use this so the two never
 * disagree about what a canonical path looks like.
 *
 * `routedPath` is the raw app-relative path, `path` is what the router matches,
 * and `pathname` is the canonical URL pathname including the base path, so the
 * caller can tell whether a redirect is needed.
 */
export function resolveRequestPath(
	pathname: string,
	base: string | null | undefined,
	trailingSlash: PluginConfig['trailingSlash'] = 'never',
) {
	const routedPath = stripBasePath(pathname, base)
	const path =
		routedPath == null
			? null
			: trailingSlash === 'ignore'
				? routedPath
				: normaliseTrailingSlash(routedPath, trailingSlash)

	return {
		routedPath,
		path,
		pathname: path == null ? null : applyBasePath(path, base),
	}
}

/**
 * Escape a literal path segment so it can be used safely in a
 * path-to-regexp pattern.
 */
function escapePathSegment(value: string) {
	return value.replace(/[\\.+*?^${}()[\]|!:]/g, '\\$&')
}

/**
 * Convert an internal route string into a path-to-regexp pattern and collect
 * the wildcard param names used in that pattern.
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
 * Apply the configured trailing-slash policy to a pathname.
 */
export function normaliseTrailingSlash(
	pathname: string,
	trailingSlash: PluginConfig['trailingSlash'] = 'never',
) {
	if (pathname === '/') return pathname
	// ignore mode keeps the incoming pathname shape as-is
	if (trailingSlash === 'ignore') return pathname

	if (trailingSlash === 'always') {
		return pathname.endsWith('/') ? pathname : `${pathname}/`
	}

	return pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
}

/**
 * Return the other pathname shape for a non-root route. For use within
 * trailingSlash logic to easily switch between shapes.
 *
 * @example
 * ```ts
 * 	getAlternatePathname('/about') // '/about/'
 * 	getAlternatePathname('/about/') // '/about'
 * 	getAlternatePathname('/') // '/'
 * ```
 */
export function getAlternatePathname(pathname: string) {
	if (pathname === '/') return pathname
	return pathname.endsWith('/') ? pathname.slice(0, -1) : `${pathname}/`
}
