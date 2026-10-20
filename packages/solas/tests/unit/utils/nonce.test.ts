import { describe, expect, it } from 'vitest'

import { addNonceToTags, createNonce, replaceNonce } from '../../../src/utils/nonce.js'

describe('createNonce', () => {
	it('returns a base64 value with 128 bits of randomness', () => {
		const nonce = createNonce()

		expect(nonce).toMatch(/^[A-Za-z0-9+/]+={0,2}$/)
		expect(Buffer.from(nonce, 'base64')).toHaveLength(16)
		expect(createNonce()).not.toBe(nonce)
	})
})

describe('addNonceToTags', () => {
	it('adds a nonce to script and style tags', () => {
		expect(addNonceToTags('<script>one</script><style>body{}</style>', 'abc')).toBe(
			'<script nonce="abc">one</script><style nonce="abc">body{}</style>',
		)
	})

	it('does not override an existing nonce', () => {
		const html = '<script nonce="existing">one</script>'

		expect(addNonceToTags(html, 'abc')).toBe(html)
	})

	it('handles self-closing tags', () => {
		expect(addNonceToTags('<script src="/app.js" />', 'abc')).toBe(
			'<script src="/app.js" nonce="abc" />',
		)
	})
})

describe('replaceNonce', () => {
	it('replaces the placeholder', () => {
		expect(replaceNonce('<script nonce="__SOLAS_NONCE__"></script>', 'abc')).toBe(
			'<script nonce="abc"></script>',
		)
	})

	it('escapes the replacement for an attribute', () => {
		expect(replaceNonce('__SOLAS_NONCE__', '"')).toBe('&quot;')
	})
})
