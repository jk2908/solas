import { Logger } from '../../utils/logger'

import { RequestContext } from '../env/request-context'
import { dynamic } from './dynamic'

const logger = new Logger()

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

	let parsed: URL

	try {
		parsed = new URL(req.url)
	} catch (err) {
		// if we throw the original error here, the rest of the code gets a messy parsing error
		// instead of a simple 'invalid request url' failure
		logger.error(`[url] invalid request url: ${req.url}`, err)
		throw new Error('Invalid request url', { cause: err })
	}

	cache.url = parsed

	return new URL(parsed)
}
