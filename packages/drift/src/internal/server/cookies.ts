import { Cookies } from '../../utils/cookies'

import { RequestContext } from '../env/request-context'
import { dynamic } from './dynamic'

/**
 * Get the request cookies as a Cookies instance
 * @returns a read-only Cookies instance containing the request cookies
 */
export function cookies(): Readonly<ReturnType<typeof Cookies.parse>> {
	dynamic()

	const { req } = RequestContext.use()
	return Cookies.parse(req.headers.get('cookie'))
}
