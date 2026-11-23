import * as Context from '../../utils/context.js'
import type { Cookies } from '../../utils/cookies.js'

import type { SolasRequest } from '../../types.js'

export type RequestCache = {
	cookies?: Readonly<ReturnType<typeof Cookies.parse>>
	headers?: ReadonlyMap<string, string>
	url?: URL
	dynamicSegments?: Set<string>
}

export const RequestContext = Context.create<{
	request: SolasRequest
	prerender: 'ppr' | 'full' | null
	cache: RequestCache
	nonce?: string
}>('request')
