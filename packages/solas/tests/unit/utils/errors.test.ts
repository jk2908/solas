import { describe, expect, it } from 'vitest'

import {
	ErrorCode,
	SolasError,
	formatError,
	isSolasError,
} from '../../../src/utils/errors.js'

describe('errors', () => {
	it('uses SCREAMING_SNAKE_CASE codes with a SOLAS_ prefix', () => {
		for (const code of Object.values(ErrorCode)) {
			expect(code).toMatch(/^SOLAS_[A-Z0-9_]+$/)
		}
	})

	it('serialises code, message and hint', () => {
		const error = new SolasError(ErrorCode.RouteConflict, 'Route conflict.', {
			hint: 'Use the same parameter name.',
		})

		expect(error.toJSON()).toEqual({
			name: 'SolasError',
			code: 'SOLAS_ROUTE_CONFLICT',
			message: 'Route conflict.',
			hint: 'Use the same parameter name.',
		})
	})

	it('formats code, hint and cause chain', () => {
		const error = new SolasError(ErrorCode.BuildFailed, 'Build failed.', {
			hint: 'Fix the route.',
			cause: new Error('boom'),
		})
		const output = formatError(error, { stack: false })

		expect(output).toContain('code  SOLAS_BUILD_FAILED')
		expect(output).toContain('hint  Fix the route.')
		expect(output).toContain('Caused by:')
		expect(output).toContain('boom')
	})

	it('recognises Solas errors across bundles', () => {
		expect(isSolasError({ code: 'SOLAS_ROUTE_CONFLICT' })).toBe(true)
		expect(isSolasError({ code: 'APP_ERROR' })).toBe(false)
		expect(isSolasError(new Error('plain'))).toBe(false)
	})
})
