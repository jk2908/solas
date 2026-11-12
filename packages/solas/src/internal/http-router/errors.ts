export type HttpRouterErrorCode =
	| 'missing-endpoint'
	| 'invalid-route-group'
	| 'missing-page-entry'
	| 'middleware-next-called'

export class HttpRouterError extends Error {
	readonly code: HttpRouterErrorCode

	constructor(code: HttpRouterErrorCode, message: string) {
		super(message)
		this.name = 'HttpRouterError'
		this.code = code
	}
}

export class MissingEndpointHandlerError extends HttpRouterError {
	readonly endpointId: string

	constructor(endpointId: string) {
		super('missing-endpoint', `Missing endpoint handler for ${endpointId}`)
		this.name = 'MissingEndpointHandlerError'
		this.endpointId = endpointId
	}
}

export class InvalidRouteGroupError extends HttpRouterError {
	constructor(message: string) {
		super('invalid-route-group', message)
		this.name = 'InvalidRouteGroupError'
	}
}

export class MissingPageEntryError extends HttpRouterError {
	constructor() {
		super('missing-page-entry', 'Unified route group missing page entry')
		this.name = 'MissingPageEntryError'
	}
}

export class MiddlewareNextCalledError extends HttpRouterError {
	constructor() {
		super('middleware-next-called', 'next() called more than once')
		this.name = 'MiddlewareNextCalledError'
	}
}

export function isHttpRouterError(error: unknown): error is HttpRouterError {
	return (
		error instanceof HttpRouterError ||
		(typeof error === 'object' &&
			error !== null &&
			'code' in error &&
			(error.code === 'missing-endpoint' ||
				error.code === 'invalid-route-group' ||
				error.code === 'missing-page-entry' ||
				error.code === 'middleware-next-called'))
	)
}
