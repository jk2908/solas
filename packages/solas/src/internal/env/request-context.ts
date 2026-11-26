import * as Context from '../../utils/context.js'
import type { Cookies } from '../../utils/cookies.js'

import type { Solas } from '../../solas.js'

export type RequestCache = {
	cookies?: Readonly<ReturnType<typeof Cookies.parse>>
	headers?: ReadonlyMap<string, string>
	url?: URL
}

export const RequestContext = Context.create<{
	request: Solas.Request
	prerender: 'ppr' | 'full' | null
	cache: RequestCache
	nonce?: string
}>('request')
