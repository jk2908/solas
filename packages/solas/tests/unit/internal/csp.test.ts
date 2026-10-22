import { describe, expect, it } from 'vitest'

import {
	addHashesToPolicy,
	buildPolicy,
	resolveNonce,
} from '../../../src/internal/csp.js'

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
			resolveNonce(null, {
				'Content-Security-Policy': "script-src 'nonce-configured'",
			}),
		).toBe('configured')
	})

	it('ignores an empty nonce', () => {
		expect(resolveNonce("script-src 'nonce-'", {})).toBeUndefined()
	})

	it('returns undefined when there is no CSP', () => {
		expect(resolveNonce(null, {})).toBeUndefined()
	})
})

describe('addHashesToPolicy', () => {
	const hashes = {
		script: ["'sha256-script'"],
		style: ["'sha256-style'"],
	}

	it('adds hashes to script-src and style-src', () => {
		expect(
			addHashesToPolicy(
				"default-src 'self'; script-src 'self'; style-src 'self'",
				hashes,
			),
		).toBe(
			"default-src 'self'; script-src 'self' 'sha256-script'; style-src 'self' 'sha256-style'",
		)
	})

	it('prefers the element directives when they are present', () => {
		expect(
			addHashesToPolicy(
				"script-src 'self'; script-src-elem 'self'; style-src 'self'; style-src-elem 'self'",
				hashes,
			),
		).toBe(
			"script-src 'self'; script-src-elem 'self' 'sha256-script'; style-src 'self'; style-src-elem 'self' 'sha256-style'",
		)
	})

	it('falls back to default-src when there is no specific directive', () => {
		expect(addHashesToPolicy("default-src 'self'", hashes)).toBe(
			"default-src 'self' 'sha256-script' 'sha256-style'",
		)
	})

	it('does not duplicate an existing hash', () => {
		expect(
			addHashesToPolicy("script-src 'self' 'sha256-script'; style-src 'self'", hashes),
		).toBe("script-src 'self' 'sha256-script'; style-src 'self' 'sha256-style'")
	})

	it('does not tighten an unsafe-inline policy', () => {
		const csp = "script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'"

		expect(addHashesToPolicy(csp, hashes)).toBe(csp)
	})

	it('does not add hashes to a none policy', () => {
		const csp = "script-src 'none'; style-src 'none'"

		expect(addHashesToPolicy(csp, hashes)).toBe(csp)
	})

	it('leaves other directives intact', () => {
		expect(
			addHashesToPolicy("default-src 'self'; object-src 'none'; script-src 'self'", {
				script: ["'sha256-script'"],
				style: [],
			}),
		).toBe("default-src 'self'; object-src 'none'; script-src 'self' 'sha256-script'")
	})
})

describe('buildPolicy', () => {
	const directives = {
		'default-src': ['self'],
		'script-src': ['self'],
		'style-src': ['self'],
	}

	it('adds a nonce to script and style directives', () => {
		expect(buildPolicy(directives, { nonce: 'abc' })).toBe(
			"default-src 'self'; script-src 'self' 'nonce-abc'; style-src 'self' 'nonce-abc'",
		)
	})

	it('adds hashes after the nonce', () => {
		expect(
			buildPolicy(directives, {
				nonce: 'abc',
				hashes: {
					script: ["'sha256-script'"],
					style: ["'sha256-style'"],
				},
			}),
		).toBe(
			"default-src 'self'; script-src 'self' 'nonce-abc' 'sha256-script'; style-src 'self' 'nonce-abc' 'sha256-style'",
		)
	})

	it('falls back to default-src for a nonce', () => {
		expect(buildPolicy({ 'default-src': ['self'] }, { nonce: 'abc' })).toBe(
			"default-src 'self' 'nonce-abc'",
		)
	})

	it('accepts keywords with or without quotes', () => {
		expect(buildPolicy({ 'script-src': ["'self'", 'none'] })).toBe(
			"script-src 'self' 'none'",
		)
	})

	it('leaves hosts and schemes unquoted', () => {
		expect(buildPolicy({ 'img-src': ['self', 'data:', 'https://cdn.example.com'] })).toBe(
			"img-src 'self' data: https://cdn.example.com",
		)
	})

	it('prefers element directives for a nonce', () => {
		expect(
			buildPolicy(
				{
					'script-src': ['self'],
					'script-src-elem': ['self'],
					'style-src': ['self'],
					'style-src-elem': ['self'],
				},
				{ nonce: 'abc' },
			),
		).toBe(
			"script-src 'self'; script-src-elem 'self' 'nonce-abc'; style-src 'self'; style-src-elem 'self' 'nonce-abc'",
		)
	})

	it('does not add a nonce to unsafe-inline', () => {
		expect(
			buildPolicy(
				{ 'script-src': ['self', 'unsafe-inline'], 'style-src': ['self'] },
				{ nonce: 'abc' },
			),
		).toBe("script-src 'self' 'unsafe-inline'; style-src 'self' 'nonce-abc'")
	})
})
