import { RequestContext } from '../env/request-context'
import { dynamic } from './dynamic'

/**
 * Get the request headers as a read-only map
 * @returns a read-only map containing the request headers
 */
export function headers(): ReadonlyMap<string, string> {
	dynamic()

	const { req } = RequestContext.use()
	const map = new Map<string, string>()

	req.headers.forEach((value, key) => {
		map.set(key, value)
	})

	return map
}
