import { RequestContext } from '../env/request-context'
import { dynamic } from './dynamic'

/**
 * Get the request url as a URL instance
 * @returns a URL instance containing the request url
 */
export function url() {
	dynamic()

	// oxlint-disable-next-line eslint-plugin-react-hooks/rules-of-hooks
	const { req, cache } = RequestContext.use()
	// use request cache if possible
	if (cache.url) return cache.url

	const parsed = new URL(req.url)
	cache.url = parsed

	return parsed
}
