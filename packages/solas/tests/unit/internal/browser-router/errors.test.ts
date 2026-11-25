import { describe, expect, it } from 'vitest'

import { ErrorCode } from '../../../../src/utils/errors.js'

import {
	BrowserRouterError,
	ExternalUrlError,
	InvalidNavigationPayloadError,
	InvalidNavigationUrlError,
	InvalidWildcardParamError,
	MissingRouteParamError,
	RouteTargetError,
	isBrowserRouterError,
	isRouteTargetError,
} from '../../../../src/internal/browser-router/errors.js'

describe('browser router errors', () => {
	it('exposes stable target codes', () => {
		const missing = new MissingRouteParamError('id')
		const wildcard = new InvalidWildcardParamError()

		expect(missing).toBeInstanceOf(RouteTargetError)
		expect(missing.code).toBe(ErrorCode.LinkMissingParam)
		expect(wildcard.code).toBe(ErrorCode.LinkInvalidWildcard)
		expect(isRouteTargetError(missing)).toBe(true)
		expect(isRouteTargetError({ code: ErrorCode.LinkInvalidWildcard })).toBe(true)
	})

	it('exposes stable navigation codes', () => {
		const external = new ExternalUrlError()
		const invalid = new InvalidNavigationUrlError()
		const payload = new InvalidNavigationPayloadError()

		expect(external).toBeInstanceOf(BrowserRouterError)
		expect(external.code).toBe(ErrorCode.RouterExternalUrl)
		expect(invalid.code).toBe(ErrorCode.RouterInvalidUrl)
		expect(payload.code).toBe(ErrorCode.RouterInvalidPayload)
		expect(isBrowserRouterError(external)).toBe(true)
		expect(isBrowserRouterError({ code: ErrorCode.RouterInvalidUrl })).toBe(true)
	})
})
