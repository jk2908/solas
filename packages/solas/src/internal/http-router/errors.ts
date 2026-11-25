import { ErrorCode, SolasError } from '../../utils/errors.js'

export type HttpRouterErrorCode =
	| typeof ErrorCode.HttpMissingEndpoint
	| typeof ErrorCode.HttpInvalidRouteGroup
	| typeof ErrorCode.HttpMissingPageEntry
	| typeof ErrorCode.HttpMiddlewareNextMultiple

export class HttpRouterError extends SolasError {
	declare readonly code: HttpRouterErrorCode

	constructor(code: HttpRouterErrorCode, message: string, hint?: string) {
		super(code, message, { hint })
		this.name = 'HttpRouterError'
	}
}

export class MissingEndpointHandlerError extends HttpRouterError {
	readonly endpointId: string

	constructor(endpointId: string) {
		super(
			ErrorCode.HttpMissingEndpoint,
			`no handler was found for endpoint "${endpointId}"`,
		)
		this.name = 'MissingEndpointHandlerError'
		this.endpointId = endpointId
	}
}

export class InvalidRouteGroupError extends HttpRouterError {
	constructor(message: string) {
		super(ErrorCode.HttpInvalidRouteGroup, message)
		this.name = 'InvalidRouteGroupError'
	}
}

export class MissingPageEntryError extends HttpRouterError {
	constructor() {
		super(
			ErrorCode.HttpMissingPageEntry,
			'the unified route group is missing a page entry',
		)
		this.name = 'MissingPageEntryError'
	}
}

export class MiddlewareNextCalledMultipleTimesError extends HttpRouterError {
	constructor() {
		super(ErrorCode.HttpMiddlewareNextMultiple, 'next() was called more than once')
		this.name = 'MiddlewareNextCalledMultipleTimesError'
	}
}

export function isHttpRouterError(error: unknown): error is HttpRouterError {
	return (
		error instanceof HttpRouterError ||
		(typeof error === 'object' &&
			error !== null &&
			'code' in error &&
			(error.code === ErrorCode.HttpMissingEndpoint ||
				error.code === ErrorCode.HttpInvalidRouteGroup ||
				error.code === ErrorCode.HttpMissingPageEntry ||
				error.code === ErrorCode.HttpMiddlewareNextMultiple))
	)
}
