import { isPathWithin, trimTrailingSlash } from '../../utils/path.js'

type Scope = 'page' | 'layout'

const GROUP_SEGMENT = /^\(.+\)$/
const OPTIONAL_CATCH_ALL = /^\[\[\.\.\..+\]\]$/
const CATCH_ALL = /^\[\.\.\..+\]$/

/**
 * Build a matcher for literal or dynamic route patterns.
 */
export function createInvalidationMatcher(pattern: string, scope: Scope) {
	const segments = trimTrailingSlash(pattern)
		.split('/')
		.filter(Boolean)
		.filter(segment => !GROUP_SEGMENT.test(segment))

	if (segments.every(segment => !isDynamic(segment))) {
		// literal patterns use direct comparison instead of a regex
		const path = `/${segments.join('/')}`

		return (candidate: string) => {
			const value = trimTrailingSlash(candidate)
			return value === path || (scope === 'layout' && isPathWithin(value, path))
		}
	}

	// optional catch-all segments also make the preceding slash optional
	const optionalCatchAll = OPTIONAL_CATCH_ALL.test(segments.at(-1) ?? '')
	const pathSegments = optionalCatchAll ? segments.slice(0, -1) : segments
	const source = pathSegments.map(toSegmentSource).join('/')
	const optionalSuffix = optionalCatchAll ? '(?:/.*)?' : ''
	const layoutSuffix = scope === 'layout' ? '(?:/.*)?' : ''
	const matcher = new RegExp(`^/${source}${optionalSuffix}${layoutSuffix}$`)

	return (candidate: string) => matcher.test(trimTrailingSlash(candidate))
}

function isDynamic(segment: string) {
	return segment.startsWith('[') || segment.startsWith(':') || segment === '*'
}

function toSegmentSource(segment: string) {
	if (segment === '*') return '.*'
	if (OPTIONAL_CATCH_ALL.test(segment)) return '.*'
	if (CATCH_ALL.test(segment)) return '.*'
	if (segment.startsWith('[') && segment.endsWith(']')) return '[^/]+'
	if (segment.startsWith(':')) return segment.endsWith('?') ? '[^/]*' : '[^/]+'

	return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
