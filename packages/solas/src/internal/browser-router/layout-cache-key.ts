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
 */
export function layoutSegmentKey(id: string, params: LayoutCacheParams | undefined) {
	return JSON.stringify([id, normaliseParams(params)])
}
