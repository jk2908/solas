import type { DriftRequest } from '../../types'

import { Context } from '../../utils/context'

export const RequestContext = Context.create<{
	req: DriftRequest
	prerender: 'ppr' | 'full' | null
}>('request')
