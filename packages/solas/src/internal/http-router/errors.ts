import { ErrorCode, SolasError, isSolasError } from '../../utils/errors.js'

import type { Solas } from '../../solas.js'

export type HttpRouterErrorCode =
	| typeof ErrorCode.HttpMissingEndpoint
	| typeof ErrorCode.HttpInvalidRouteGroup
	| typeof ErrorCode.HttpMissingPageEntry
	| typeof ErrorCode.HttpMiddlewareNextMultiple

export type HttpRouterError = Solas.Error &
	(
		| {
				readonly code: typeof ErrorCode.HttpMissingEndpoint
				readonly endpointId: string
		  }
		| {
				readonly code: typeof ErrorCode.HttpInvalidRouteGroup
		  }
		| {
				readonly code: typeof ErrorCode.HttpMissingPageEntry
		  }
		| {
				readonly code: typeof ErrorCode.HttpMiddlewareNextMultiple
		  }
	)

export class HttpRouterErrorImpl extends SolasError {
	declare readonly code: HttpRouterErrorCode

	constructor(code: HttpRouterErrorCode, message: string, hint?: string) {
		super(code, message, { hint })
		this.name = 'HttpRouterError'
	}
}

export class MissingEndpointHandlerError extends HttpRouterErrorImpl {
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

export class InvalidRouteGroupError extends HttpRouterErrorImpl {
	constructor(message: string) {
		super(ErrorCode.HttpInvalidRouteGroup, message)
		this.name = 'InvalidRouteGroupError'
	}
}

export class MissingPageEntryError extends HttpRouterErrorImpl {
	constructor() {
		super(
			ErrorCode.HttpMissingPageEntry,
			'the unified route group is missing a page entry',
		)
		this.name = 'MissingPageEntryError'
	}
}

export class MiddlewareNextCalledMultipleTimesError extends HttpRouterErrorImpl {
	constructor() {
		super(ErrorCode.HttpMiddlewareNextMultiple, 'next() was called more than once')
		this.name = 'MiddlewareNextCalledMultipleTimesError'
	}
}

export function isHttpRouterError(error: unknown): error is HttpRouterError {
	return (
		isSolasError(error) &&
		(error.code === ErrorCode.HttpMissingEndpoint ||
			error.code === ErrorCode.HttpInvalidRouteGroup ||
			error.code === ErrorCode.HttpMissingPageEntry ||
			error.code === ErrorCode.HttpMiddlewareNextMultiple)
	)
}
