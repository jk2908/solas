const NONCE_PLACEHOLDER = '__SOLAS_NONCE__'

const NONCE_TAG = /<(script|style)\b[^>]*>/gi
const EXISTING_NONCE = /\bnonce\s*=/i

function escapeAttribute(value: string) {
	return value
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
}

/**
 * Generate a per-request CSP nonce with 128 bits of randomness.
 */
export function createNonce() {
	const bytes = new Uint8Array(16)
	crypto.getRandomValues(bytes)

	let binary = ''

	for (const byte of bytes) binary += String.fromCharCode(byte)

	return btoa(binary)
}

/**
 * Add a nonce attribute to every inline `<script>` and `<style>` tag that does
 * not already have one.
 *
 * Used for prerendered HTML, where React's own `nonce` option is not available
 * for every rendering path. Tags that already carry a nonce are left untouched.
 */
export function addNonceToTags(html: string, nonce: string) {
	const value = escapeAttribute(nonce)

	return html.replace(NONCE_TAG, tag => {
		if (EXISTING_NONCE.test(tag)) return tag

		if (tag.endsWith('/>')) {
			return `${tag.slice(0, -2).trimEnd()} nonce="${value}" />`
		}

		return `${tag.slice(0, -1)} nonce="${value}">`
	})
}

/**
 * Replace the build-time nonce placeholder in prerendered HTML with the
 * request-time nonce.
 */
export function replaceNonce(html: string, nonce: string) {
	return html.replaceAll(NONCE_PLACEHOLDER, escapeAttribute(nonce))
}

export { NONCE_PLACEHOLDER }
