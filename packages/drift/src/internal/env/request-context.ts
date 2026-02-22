import { Context } from '../../utils/context'

export type RequestState = {
	prerender: boolean
}

export const RequestContext = Context.create<RequestState>('request')
