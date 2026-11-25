import { describe, expect, it } from 'vitest'

import { ErrorCode } from '../../../../src/utils/errors.js'

import {
	HttpRouterError,
	InvalidRouteGroupError,
	MiddlewareNextCalledMultipleTimesError,
	MissingEndpointHandlerError,
	MissingPageEntryError,
	isHttpRouterError,
} from '../../../../src/internal/http-router/errors.js'

describe('http router errors', () => {
	it('exposes stable server router codes', () => {
		const missing = new MissingEndpointHandlerError('endpoint')
		const group = new InvalidRouteGroupError('invalid group')
		const page = new MissingPageEntryError()
		const next = new MiddlewareNextCalledMultipleTimesError()

		expect(missing).toBeInstanceOf(HttpRouterError)
		expect(missing.code).toBe(ErrorCode.HttpMissingEndpoint)
		expect(group.code).toBe(ErrorCode.HttpInvalidRouteGroup)
		expect(page.code).toBe(ErrorCode.HttpMissingPageEntry)
		expect(next.code).toBe(ErrorCode.HttpMiddlewareNextMultiple)
		expect(isHttpRouterError(missing)).toBe(true)
		expect(isHttpRouterError({ code: ErrorCode.HttpInvalidRouteGroup })).toBe(true)
	})
})
