import { Logger } from '../../utils/logger'

import { RequestContext } from '../env/request-context'

const logger = new Logger()
const NEVER: Promise<never> = new Promise(() => {})

/**
 * Declaratively mark render below this call as request-time only
 * @description in prerender mode this suspends forever so the nearest Suspense
 * boundary renders its fallback into the static shell. In request mode this
 * resolves immediately
 * @returns void during normal requests or prerender not in ppr mode
 * @throws if called in prerender mode (the desired effect)
 */
export function dynamic() {
	const { prerender } = RequestContext.use()

	if (!prerender) return

	if (prerender !== 'ppr') {
		logger.warn(
			'[dynamic]',
			"dynamic() was called but prerender mode is not 'ppr'. This means the component will be rendered at build time, which may not be what you intended",
		)

		return
	}

	throw NEVER
}
