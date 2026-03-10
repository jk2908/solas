import { RequestContext } from '../env/request-context'
import { dynamic } from './dynamic'

/**
 * Get the request url as a URL instance
 */
export function url() {
	dynamic()

	const { req } = RequestContext.use()
	return new URL(req.url)
}
