import { Cookies } from '../../utils/cookies.js'

import { RequestContext } from '../env/request-context.js'
import { dynamic } from './dynamic.js'

/**
 * Get the request cookies as a Cookies instance
 * @returns a Promise resolving to a read-only Cookies instance containing the
 * request cookies
 */
export async function cookies(): Promise<Readonly<ReturnType<typeof Cookies.parse>>> {
	await dynamic()

	const { req, cache } = RequestContext.use()
	// use request cache if possible to avoid reparsing
	if (cache.cookies) return cache.cookies

	const parsed = Cookies.parse(req.headers.get('cookie'))
	cache.cookies = parsed

	return parsed
}
