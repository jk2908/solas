import { ErrorCode, SolasError } from '../../utils/errors.js'

export type RouteTargetErrorCode =
	| typeof ErrorCode.LinkMissingParam
	| typeof ErrorCode.LinkInvalidWildcard

export class RouteTargetError extends SolasError {
	declare readonly code: RouteTargetErrorCode

	constructor(code: RouteTargetErrorCode, message: string, hint?: string) {
		super(code, message, { hint })
		this.name = 'RouteTargetError'
	}
}

export class MissingRouteParamError extends RouteTargetError {
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

export class InvalidWildcardParamError extends RouteTargetError {
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

export class BrowserRouterError extends SolasError {
	declare readonly code: BrowserRouterErrorCode

	constructor(code: BrowserRouterErrorCode, message: string, hint?: string) {
		super(code, message, { hint })
		this.name = 'BrowserRouterError'
	}
}

export class ExternalUrlError extends BrowserRouterError {
	constructor() {
		super(
			ErrorCode.RouterExternalUrl,
			'router.go() only supports internal URLs',
			'Use an <a> element for external links.',
		)
		this.name = 'ExternalUrlError'
	}
}

export class InvalidNavigationUrlError extends BrowserRouterError {
	constructor() {
		super(ErrorCode.RouterInvalidUrl, 'router.go() received an invalid URL')
		this.name = 'InvalidNavigationUrlError'
	}
}

export class InvalidNavigationPayloadError extends BrowserRouterError {
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
		error instanceof BrowserRouterError ||
		(typeof error === 'object' &&
			error !== null &&
			'code' in error &&
			(error.code === ErrorCode.RouterExternalUrl ||
				error.code === ErrorCode.RouterInvalidUrl ||
				error.code === ErrorCode.RouterInvalidPayload))
	)
}

export function isRouteTargetError(error: unknown): error is RouteTargetError {
	return (
		error instanceof RouteTargetError ||
		(typeof error === 'object' &&
			error !== null &&
			'code' in error &&
			(error.code === ErrorCode.LinkMissingParam ||
				error.code === ErrorCode.LinkInvalidWildcard))
	)
}
