import { RequestContext } from '../env/request-context.js'

const NEVER: Promise<never> = new Promise(() => {})

/**
 * Declaratively mark render below this call as request-time only
 * @description in prerender mode this suspends forever so the nearest Suspense
 * boundary renders its fallback into the static shell. In request mode this
 * resolves immediately
 */
export async function dynamic() {
	const { prerender } = RequestContext.use()
	if (prerender !== 'ppr') return

	await NEVER
}
