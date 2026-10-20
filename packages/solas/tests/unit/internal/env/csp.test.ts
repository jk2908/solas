import { describe, expect, it } from 'vitest'

import { resolveNonce } from '../../../../src/internal/env/csp.js'

describe('resolveNonce', () => {
	it('prefers the client document nonce', () => {
		expect(
			resolveNonce(
				"script-src 'self'",
				{ 'content-security-policy': "script-src 'nonce-configured'" },
				'client',
			),
		).toBe('client')
	})

	it('uses the request CSP', () => {
		expect(
			resolveNonce("script-src 'nonce-request'", {
				'content-security-policy': "script-src 'nonce-configured'",
			}),
		).toBe('request')
	})

	it('treats a request CSP without a nonce as authoritative', () => {
		expect(
			resolveNonce("script-src 'self'", {
				'Content-Security-Policy': "script-src 'nonce-configured'",
			}),
		).toBeUndefined()
	})

	it('falls back to configured headers', () => {
		expect(
			resolveNonce(null, { 'Content-Security-Policy': "script-src 'nonce-configured'" }),
		).toBe('configured')
	})

	it('ignores an empty nonce', () => {
		expect(resolveNonce("script-src 'nonce-'", {})).toBeUndefined()
	})

	it('returns undefined when there is no CSP', () => {
		expect(resolveNonce(null, {})).toBeUndefined()
	})
})
