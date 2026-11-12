import { describe, expect, it } from 'vitest'

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
		expect(missing.code).toBe('missing-param')
		expect(wildcard.code).toBe('invalid-wildcard')
		expect(isRouteTargetError(missing)).toBe(true)
		expect(isRouteTargetError({ code: 'invalid-wildcard' })).toBe(true)
	})

	it('exposes stable navigation codes', () => {
		const external = new ExternalUrlError()
		const invalid = new InvalidNavigationUrlError()
		const payload = new InvalidNavigationPayloadError()

		expect(external).toBeInstanceOf(BrowserRouterError)
		expect(external.code).toBe('external-url')
		expect(invalid.code).toBe('invalid-url')
		expect(payload.code).toBe('invalid-payload')
		expect(isBrowserRouterError(external)).toBe(true)
		expect(isBrowserRouterError({ code: 'invalid-url' })).toBe(true)
	})
})
