import { describe, expect, it } from 'vitest'

import {
	HttpRouterError,
	InvalidRouteGroupError,
	MiddlewareNextCalledError,
	MissingEndpointHandlerError,
	MissingPageEntryError,
	isHttpRouterError,
} from '../../../../src/internal/http-router/errors.js'

describe('http router errors', () => {
	it('exposes stable server router codes', () => {
		const missing = new MissingEndpointHandlerError('endpoint')
		const group = new InvalidRouteGroupError('invalid group')
		const page = new MissingPageEntryError()
		const next = new MiddlewareNextCalledError()

		expect(missing).toBeInstanceOf(HttpRouterError)
		expect(missing.code).toBe('missing-endpoint')
		expect(group.code).toBe('invalid-route-group')
		expect(page.code).toBe('missing-page-entry')
		expect(next.code).toBe('middleware-next-called')
		expect(isHttpRouterError(missing)).toBe(true)
		expect(isHttpRouterError({ code: 'invalid-route-group' })).toBe(true)
	})
})
