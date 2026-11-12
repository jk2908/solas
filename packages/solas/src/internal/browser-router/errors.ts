export type RouteTargetErrorCode = 'missing-param' | 'invalid-wildcard'

export class RouteTargetError extends Error {
	readonly code: RouteTargetErrorCode

	constructor(code: RouteTargetErrorCode, message: string) {
		super(message)
		this.name = 'RouteTargetError'
		this.code = code
	}
}

export class MissingRouteParamError extends RouteTargetError {
	readonly param: string

	constructor(param: string) {
		super('missing-param', `[Link]: missing route param: ${param}`)
		this.name = 'MissingRouteParamError'
		this.param = param
	}
}

export class InvalidWildcardParamError extends RouteTargetError {
	constructor() {
		super(
			'invalid-wildcard',
			'[Link]: wildcard routes require exactly one unmatched param',
		)
		this.name = 'InvalidWildcardParamError'
	}
}

export type BrowserRouterErrorCode = 'external-url' | 'invalid-url' | 'invalid-payload'

export class BrowserRouterError extends Error {
	readonly code: BrowserRouterErrorCode

	constructor(code: BrowserRouterErrorCode, message: string) {
		super(message)
		this.name = 'BrowserRouterError'
		this.code = code
	}
}

export class ExternalUrlError extends BrowserRouterError {
	constructor() {
		super('external-url', '[router.go]: External URLs are not supported. Use <a> instead')
		this.name = 'ExternalUrlError'
	}
}

export class InvalidNavigationUrlError extends BrowserRouterError {
	constructor() {
		super('invalid-url', '[router.go]: Invalid navigation url')
		this.name = 'InvalidNavigationUrlError'
	}
}

export class InvalidNavigationPayloadError extends BrowserRouterError {
	constructor() {
		super('invalid-payload', '[router.go]: route response did not contain a payload')
		this.name = 'InvalidNavigationPayloadError'
	}
}

export function isBrowserRouterError(error: unknown): error is BrowserRouterError {
	return (
		error instanceof BrowserRouterError ||
		(typeof error === 'object' &&
			error !== null &&
			'code' in error &&
			(error.code === 'external-url' ||
				error.code === 'invalid-url' ||
				error.code === 'invalid-payload'))
	)
}

export function isRouteTargetError(error: unknown): error is RouteTargetError {
	return (
		error instanceof RouteTargetError ||
		(typeof error === 'object' &&
			error !== null &&
			'code' in error &&
			(error.code === 'missing-param' || error.code === 'invalid-wildcard'))
	)
}
