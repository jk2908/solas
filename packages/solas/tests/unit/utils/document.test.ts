// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest'

import { getDocumentNonce } from '../../../src/utils/document.js'

describe('getDocumentNonce', () => {
	afterEach(() => {
		document.head.innerHTML = ''
		document.body.innerHTML = ''
	})

	it('reads the nonce from a nonced script', () => {
		const script = document.createElement('script')
		script.setAttribute('nonce', 'abc123')
		document.head.appendChild(script)

		expect(getDocumentNonce()).toBe('abc123')
	})

	it('reads the nonce from a nonced style', () => {
		const style = document.createElement('style')
		style.setAttribute('nonce', 'style-nonce')
		document.head.appendChild(style)

		expect(getDocumentNonce()).toBe('style-nonce')
	})

	it('does not use a meta tag as the nonce source', () => {
		const meta = document.createElement('meta')
		meta.name = 'solas-nonce'
		meta.content = 'meta-nonce'
		document.head.appendChild(meta)

		expect(getDocumentNonce()).toBeUndefined()
	})

	it('returns undefined without a nonce', () => {
		expect(getDocumentNonce()).toBeUndefined()
	})
})
