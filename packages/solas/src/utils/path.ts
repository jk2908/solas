/**
 * Convert Windows path separators to forward slashes.
 */
export function normalisePath(value: string) {
	return value.replace(/\\/g, '/')
}

/**
 * Remove trailing slashes without changing the root path.
 */
export function trimTrailingSlash(pathname: string) {
	return pathname === '/' ? pathname : pathname.replace(/\/+$/, '')
}

/**
 * Whether a path equals or sits below another path.
 */
export function isPathWithin(candidate: string, path: string) {
	return candidate === path || path === '/' || candidate.startsWith(`${path}/`)
}
