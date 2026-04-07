import type { SolasRequest } from '../../types.js'

import { Context } from '../../utils/context.js'
import type { Cookies } from '../../utils/cookies.js'

export type RequestCache = {
	cookies?: Readonly<ReturnType<typeof Cookies.parse>>
	headers?: ReadonlyMap<string, string>
	url?: URL
}

export const RequestContext = Context.create<{
	req: SolasRequest
	prerender: 'ppr' | 'full' | null
	cache: RequestCache
}>('request')
