import { isPathWithin, trimTrailingSlash } from '../../utils/path.js'

type Scope = 'page' | 'layout'

const GROUP_SEGMENT = /^\(.+\)$/

/**
 * Build a matcher for literal or dynamic route patterns.
 */
export function createInvalidationMatcher(pattern: string, scope: Scope) {
	const segments = trimTrailingSlash(pattern)
		.split('/')
		.filter(Boolean)
		.filter(segment => !GROUP_SEGMENT.test(segment))

	if (segments.every(segment => !isDynamic(segment))) {
		const path = `/${segments.join('/')}`.replace(/^\/$/, '/')

		return (candidate: string) => {
			const value = trimTrailingSlash(candidate)
			return value === path || (scope === 'layout' && isPathWithin(value, path))
		}
	}

	const source = segments.map(toSegmentSource).join('/')
	const suffix = scope === 'layout' ? '(?:/.*)?' : ''
	const matcher = new RegExp(`^/${source}${suffix}$`)

	return (candidate: string) => matcher.test(trimTrailingSlash(candidate))
}

function isDynamic(segment: string) {
	return segment.startsWith('[') || segment.startsWith(':') || segment === '*'
}

function toSegmentSource(segment: string) {
	if (segment === '*') return '.*'
	if (segment.startsWith('[[') && segment.endsWith(']]')) return '.*'
	if (segment.startsWith('[...') && segment.endsWith(']')) return '.*'
	if (segment.startsWith('[') && segment.endsWith(']')) return '[^/]+'
	if (segment.startsWith(':')) return segment.endsWith('?') ? '[^/]*' : '[^/]+'

	return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
