import type { RscSegment } from '../route-segments.js'

export type LayoutCacheParams = Record<string, string | string[]>

/**
 * Build a cache key for a resolved layout chain.
 *
 * Layouts receive route params, so two routes can only share layout nodes when
 * they use the same layout chain and the same params. Params are sorted so the
 * key is independent of insertion order.
 */
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

export function layoutCacheKey(
	segments: RscSegment | undefined,
	params: LayoutCacheParams | undefined,
) {
	const layouts = (segments?.layouts ?? []).filter(
		(id): id is string => typeof id === 'string',
	)

	return JSON.stringify([layouts, normaliseParams(params)])
}
