import { RequestContext } from '../env/request-context.js'
import { SegmentContext } from '../env/segment-context.js'

const NEVER: Promise<never> = new Promise(() => {})

/**
 * Declaratively mark render below this call as request-time only.
 *
 * During PPR prerender this suspends; during request rendering it marks the
 * active segment so the patch can avoid statically caching that segment.
 */
export async function dynamic() {
	const request = RequestContext.use()
	const segment = SegmentContext.tryUse()

	if (segment) {
		;(request.cache.dynamicSegments ??= new Set()).add(segment.id)
	}

	if (request.prerender !== 'ppr') return

	await NEVER
}
