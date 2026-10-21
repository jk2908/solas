import { describe, expect, it } from 'vitest'

import { Csp } from '../../../src/internal/csp.js'

describe('Csp.resolveNonce', () => {
	it('prefers the client document nonce', () => {
		expect(
			Csp.resolveNonce(
				"script-src 'self'",
				{ 'content-security-policy': "script-src 'nonce-configured'" },
				'client',
			),
		).toBe('client')
	})

	it('uses the request CSP', () => {
		expect(
			Csp.resolveNonce("script-src 'nonce-request'", {
				'content-security-policy': "script-src 'nonce-configured'",
			}),
		).toBe('request')
	})

	it('treats a request CSP without a nonce as authoritative', () => {
		expect(
			Csp.resolveNonce("script-src 'self'", {
				'Content-Security-Policy': "script-src 'nonce-configured'",
			}),
		).toBeUndefined()
	})

	it('falls back to configured headers', () => {
		expect(
			Csp.resolveNonce(null, {
				'Content-Security-Policy': "script-src 'nonce-configured'",
			}),
		).toBe('configured')
	})

	it('ignores an empty nonce', () => {
		expect(Csp.resolveNonce("script-src 'nonce-'", {})).toBeUndefined()
	})

	it('returns undefined when there is no CSP', () => {
		expect(Csp.resolveNonce(null, {})).toBeUndefined()
	})
})

describe('Csp.addHashes', () => {
	const hashes = {
		script: ["'sha256-script'"],
		style: ["'sha256-style'"],
	}

	it('adds hashes to script-src and style-src', () => {
		expect(
			Csp.addHashes("default-src 'self'; script-src 'self'; style-src 'self'", hashes),
		).toBe(
			"default-src 'self'; script-src 'self' 'sha256-script'; style-src 'self' 'sha256-style'",
		)
	})

	it('prefers the element directives when they are present', () => {
		expect(
			Csp.addHashes(
				"script-src 'self'; script-src-elem 'self'; style-src 'self'; style-src-elem 'self'",
				hashes,
			),
		).toBe(
			"script-src 'self'; script-src-elem 'self' 'sha256-script'; style-src 'self'; style-src-elem 'self' 'sha256-style'",
		)
	})

	it('falls back to default-src when there is no specific directive', () => {
		expect(Csp.addHashes("default-src 'self'", hashes)).toBe(
			"default-src 'self' 'sha256-script' 'sha256-style'",
		)
	})

	it('does not duplicate an existing hash', () => {
		expect(
			Csp.addHashes("script-src 'self' 'sha256-script'; style-src 'self'", hashes),
		).toBe("script-src 'self' 'sha256-script'; style-src 'self' 'sha256-style'")
	})

	it('does not tighten an unsafe-inline policy', () => {
		const csp = "script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'"

		expect(Csp.addHashes(csp, hashes)).toBe(csp)
	})

	it('does not add hashes to a none policy', () => {
		const csp = "script-src 'none'; style-src 'none'"

		expect(Csp.addHashes(csp, hashes)).toBe(csp)
	})

	it('leaves other directives intact', () => {
		expect(
			Csp.addHashes("default-src 'self'; object-src 'none'; script-src 'self'", {
				script: ["'sha256-script'"],
				style: [],
			}),
		).toBe("default-src 'self'; object-src 'none'; script-src 'self' 'sha256-script'")
	})
})

describe('Csp.build', () => {
	const directives = {
		'default-src': ['self'],
		'script-src': ['self'],
		'style-src': ['self'],
	}

	it('adds a nonce to script and style directives', () => {
		expect(Csp.build(directives, 'abc')).toBe(
			"default-src 'self'; script-src 'self' 'nonce-abc'; style-src 'self' 'nonce-abc'",
		)
	})

	it('adds hashes after the nonce', () => {
		expect(
			Csp.build(directives, 'abc', {
				script: ["'sha256-script'"],
				style: ["'sha256-style'"],
			}),
		).toBe(
			"default-src 'self'; script-src 'self' 'nonce-abc' 'sha256-script'; style-src 'self' 'nonce-abc' 'sha256-style'",
		)
	})

	it('falls back to default-src for a nonce', () => {
		expect(Csp.build({ 'default-src': ['self'] }, 'abc')).toBe(
			"default-src 'self' 'nonce-abc'",
		)
	})

	it('accepts keywords with or without quotes', () => {
		expect(Csp.build({ 'script-src': ["'self'", 'none'] })).toBe(
			"script-src 'self' 'none'",
		)
	})

	it('leaves hosts and schemes unquoted', () => {
		expect(Csp.build({ 'img-src': ['self', 'data:', 'https://cdn.example.com'] })).toBe(
			"img-src 'self' data: https://cdn.example.com",
		)
	})

	it('prefers element directives for a nonce', () => {
		expect(
			Csp.build(
				{
					'script-src': ['self'],
					'script-src-elem': ['self'],
					'style-src': ['self'],
					'style-src-elem': ['self'],
				},
				'abc',
			),
		).toBe(
			"script-src 'self'; script-src-elem 'self' 'nonce-abc'; style-src 'self'; style-src-elem 'self' 'nonce-abc'",
		)
	})

	it('does not add a nonce to unsafe-inline', () => {
		expect(
			Csp.build(
				{ 'script-src': ['self', 'unsafe-inline'], 'style-src': ['self'] },
				'abc',
			),
		).toBe("script-src 'self' 'unsafe-inline'; style-src 'self' 'nonce-abc'")
	})
})
