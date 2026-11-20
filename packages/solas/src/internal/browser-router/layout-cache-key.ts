import type { RscSegment } from '../route-segments.js'

export type LayoutCacheParams = Record<string, string | string[]>

/**
 * Build a cache key for a resolved layout chain.
 *
 * Layouts receive route params, so two routes can only share layout nodes when
 * they use the same layout chain and the same params. Params are sorted so the
 * key is independent of insertion order.
 */
export function layoutCacheKey(
	segments: RscSegment | undefined,
	params: LayoutCacheParams | undefined,
) {
	const layouts = (segments?.layouts ?? []).filter(
		(id): id is string => typeof id === 'string',
	)
	const sortedParams =
		params === undefined
			? {}
			: Object.fromEntries(
					Object.keys(params)
						.sort()
						.map(key => [key, params[key]]),
				)

	return JSON.stringify([layouts, sortedParams])
}
