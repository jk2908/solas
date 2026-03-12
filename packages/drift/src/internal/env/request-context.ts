import type { DriftRequest } from '../../types'

import { Context } from '../../utils/context'
import type { Cookies } from '../../utils/cookies'

export type RequestCache = {
	cookies?: Readonly<ReturnType<typeof Cookies.parse>>
	headers?: ReadonlyMap<string, string>
	url?: URL
}

export const RequestContext = Context.create<{
	req: DriftRequest
	prerender: 'ppr' | 'full' | null
	cache: RequestCache
}>('request')
