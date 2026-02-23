import { Context } from '../../utils/context'

export const RequestContext = Context.create<{
	prerender: 'ppr' | 'full' | null
}>('request')
