import { RequestContext } from '../env/request-context'
import { dynamic } from './dynamic'

/**
 * Get the request url as a URL instance
 * @returns a URL instance containing the request url
 */
export function url() {
	dynamic()

	const { req, cache } = RequestContext.use()

	// always return a clone so consumers can mutate (e.g. searchParams.set)
	// without corrupting the cached instance shared across the request
	if (cache.url) return new URL(cache.url)

	const parsed = new URL(req.url)
	cache.url = parsed

	return new URL(parsed)
}
