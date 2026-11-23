export type LayoutCacheParams = Record<string, string | string[]>

function normaliseParams(params: LayoutCacheParams | undefined) {
	return params === undefined
		? {}
		: Object.fromEntries(
				Object.keys(params)
					.sort()
					.map(key => [key, params[key]]),
			)
}

/**
 * Build a cache key for one independently cached layout node.
 *
 * Search is deliberately excluded: static layouts may depend on route params,
 * but not on request-specific query state.
 */
export function layoutSegmentKey(id: string, params: LayoutCacheParams | undefined) {
	return JSON.stringify([id, normaliseParams(params)])
}
