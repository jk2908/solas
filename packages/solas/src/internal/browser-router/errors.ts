import { ErrorCode, SolasError, isSolasError } from '../../utils/errors.js'

import type { Solas } from '../../solas.js'

export type RouteTargetErrorCode =
	| typeof ErrorCode.LinkMissingParam
	| typeof ErrorCode.LinkInvalidWildcard

export type RouteTargetError = Solas.Error &
	(
		| {
				readonly code: typeof ErrorCode.LinkMissingParam
				readonly param: string
		  }
		| {
				readonly code: typeof ErrorCode.LinkInvalidWildcard
		  }
	)

export class RouteTargetErrorImpl extends SolasError {
	declare readonly code: RouteTargetErrorCode

	constructor(code: RouteTargetErrorCode, message: string, hint?: string) {
		super(code, message, { hint })
		this.name = 'RouteTargetError'
	}
}

export class MissingRouteParamError extends RouteTargetErrorImpl {
	readonly param: string

	constructor(param: string) {
		super(
			ErrorCode.LinkMissingParam,
			`Link is missing the route parameter "${param}"`,
			`Pass it in the params prop, for example params={{ ${param}: value }}.`,
		)
		this.name = 'MissingRouteParamError'
		this.param = param
	}
}

export class InvalidWildcardParamError extends RouteTargetErrorImpl {
	constructor() {
		super(
			ErrorCode.LinkInvalidWildcard,
			'a wildcard route requires exactly one unmatched parameter',
		)
		this.name = 'InvalidWildcardParamError'
	}
}

export type BrowserRouterErrorCode =
	| typeof ErrorCode.RouterExternalUrl
	| typeof ErrorCode.RouterInvalidUrl
	| typeof ErrorCode.RouterInvalidPayload

export type BrowserRouterError = Solas.Error &
	(
		| {
				readonly code: typeof ErrorCode.RouterExternalUrl
		  }
		| {
				readonly code: typeof ErrorCode.RouterInvalidUrl
		  }
		| {
				readonly code: typeof ErrorCode.RouterInvalidPayload
		  }
	)

export class BrowserRouterErrorImpl extends SolasError {
	declare readonly code: BrowserRouterErrorCode

	constructor(code: BrowserRouterErrorCode, message: string, hint?: string) {
		super(code, message, { hint })
		this.name = 'BrowserRouterError'
	}
}

export class ExternalUrlError extends BrowserRouterErrorImpl {
	constructor() {
		super(
			ErrorCode.RouterExternalUrl,
			'router.go() only supports internal URLs',
			'Use an <a> element for external links.',
		)
		this.name = 'ExternalUrlError'
	}
}

export class InvalidNavigationUrlError extends BrowserRouterErrorImpl {
	constructor() {
		super(ErrorCode.RouterInvalidUrl, 'router.go() received an invalid URL')
		this.name = 'InvalidNavigationUrlError'
	}
}

export class InvalidNavigationPayloadError extends BrowserRouterErrorImpl {
	constructor() {
		super(
			ErrorCode.RouterInvalidPayload,
			'the route response did not include an RSC payload',
		)
		this.name = 'InvalidNavigationPayloadError'
	}
}

export function isBrowserRouterError(error: unknown): error is BrowserRouterError {
	return (
		isSolasError(error) &&
		(error.code === ErrorCode.RouterExternalUrl ||
			error.code === ErrorCode.RouterInvalidUrl ||
			error.code === ErrorCode.RouterInvalidPayload)
	)
}

export function isRouteTargetError(error: unknown): error is RouteTargetError {
	return (
		isSolasError(error) &&
		(error.code === ErrorCode.LinkMissingParam ||
			error.code === ErrorCode.LinkInvalidWildcard)
	)
}
