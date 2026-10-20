import { RequestContext } from './internal/env/request-context.js'

export { cookies } from './internal/server/cookies.js'
export { dynamic } from './internal/server/dynamic.js'
export { headers } from './internal/server/headers.js'
export { url } from './internal/server/url.js'

/**
 * The per-request CSP nonce, or `undefined` when `nonce` is not enabled.
 *
 * Use this to nonce inline `<style>` or custom `<script>` tags in server
 * components. Solas already nonces the scripts it generates.
 */
export function nonce() {
	return RequestContext.get().nonce
}
