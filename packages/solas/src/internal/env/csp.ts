const NONCE = /'nonce-([^']+)'/

function extractNonce(csp: string | null | undefined) {
	return csp?.match(NONCE)?.[1] || undefined
}

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
	if (requestCsp) return extractNonce(requestCsp)

	return extractNonce(new Headers(configuredHeaders).get('content-security-policy'))
}
