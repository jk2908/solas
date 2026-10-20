/**
 * Resolve the nonce for a request.
 *
 * On RSC and action requests a document nonce supplied by the client wins.
 * Otherwise the request CSP is authoritative, even when it has no nonce, and
 * configured headers are the fallback.
 */
export function resolveNonce(
	requestCsp: string | null | undefined,
	configuredHeaders: Record<string, string>,
	clientNonce?: string | null,
) {
	if (clientNonce) return clientNonce
	if (requestCsp) return extract(requestCsp)

	return extract(new Headers(configuredHeaders).get('content-security-policy'))
}

function extract(csp: string | null | undefined) {
	return csp?.match(/'nonce-([^']+)'/)?.[1] || undefined
}
