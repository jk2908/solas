import { Cookies } from '../../utils/cookies'

import { RequestContext } from '../env/request-context'
import { dynamic } from './dynamic'

/**
 * Get the request cookies as a Cookies instance
 * @returns a read-only Cookies instance containing the request cookies
 */
export function cookies(): Readonly<ReturnType<typeof Cookies.parse>> {
	dynamic()

	// oxlint-disable-next-line eslint-plugin-react-hooks/rules-of-hooks
	const { req, cache } = RequestContext.use()
	// use request cache if possible to avoid reparsing
	if (cache.cookies) return cache.cookies

	const parsed = Cookies.parse(req.headers.get('cookie'))
	cache.cookies = parsed

	return parsed
}
