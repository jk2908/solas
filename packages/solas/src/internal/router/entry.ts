import type { RSCPayload } from '../env/rsc'

export type RouteEntry = {
	id: number
	path: string
	requestedPath: string
	payload: RSCPayload
}