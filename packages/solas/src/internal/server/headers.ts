import { RequestContext } from '../env/request-context.js'
import { dynamic } from './dynamic.js'

/**
 * Get the request headers as a read-only map
 * @returns a read-only map of request headers
 */
export function headers(): ReadonlyMap<string, string> {
	dynamic()

	const { req, cache } = RequestContext.use()
	// use request cache if possible to avoid reconstructing the map
	if (cache.headers) return cache.headers

	const map = new Map<string, string>()

	req.headers.forEach((value: string, key: string) => {
		map.set(key, value)
	})

	cache.headers = map

	return map
}
