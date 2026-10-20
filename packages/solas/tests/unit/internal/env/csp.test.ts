import { describe, expect, it } from 'vitest'

import {
	extractNonce,
	getHeader,
	resolveNonce,
} from '../../../../src/internal/env/csp.js'

describe('extractNonce', () => {
	it('extracts a nonce from script-src', () => {
		expect(extractNonce("default-src 'self'; script-src 'nonce-abc123'")).toBe('abc123')
	})

	it('extracts a nonce from style-src', () => {
		expect(extractNonce("style-src 'self' 'nonce-XYZ+/='")).toBe('XYZ+/=')
	})

	it('returns undefined when there is no nonce', () => {
		expect(extractNonce("default-src 'self'")).toBeUndefined()
		expect(extractNonce(null)).toBeUndefined()
		expect(extractNonce(undefined)).toBeUndefined()
	})

	it('ignores an empty nonce', () => {
		expect(extractNonce("script-src 'nonce-'")).toBeUndefined()
	})
})

describe('getHeader', () => {
	it('finds a header case-insensitively', () => {
		expect(
			getHeader(
				{ 'content-security-policy': "script-src 'self'" },
				'Content-Security-Policy',
			),
		).toBe("script-src 'self'")
	})

	it('returns undefined for a missing header', () => {
		expect(getHeader({}, 'content-security-policy')).toBeUndefined()
	})
})

describe('resolveNonce', () => {
	it('prefers the request nonce', () => {
		expect(
			resolveNonce("script-src 'nonce-request'", "script-src 'nonce-configured'"),
		).toBe('request')
	})

	it('does not fall back to the configured nonce when the request has a CSP', () => {
		expect(
			resolveNonce("script-src 'self'", "script-src 'nonce-configured'"),
		).toBeUndefined()
	})

	it('falls back to the configured nonce when the request has no CSP', () => {
		expect(resolveNonce(null, "script-src 'nonce-configured'")).toBe('configured')
	})

	it('returns undefined when neither has a nonce', () => {
		expect(resolveNonce(null, undefined)).toBeUndefined()
	})
})
