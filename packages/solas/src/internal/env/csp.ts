const NONCE = /'nonce-([^']+)'/

/**
 * Extract the first CSP nonce from a Content-Security-Policy header value.
 */
export function extractNonce(csp: string | null | undefined) {
	if (!csp) return undefined

	const value = NONCE.exec(csp)?.[1]

	return value || undefined
}

/**
 * Find a header value case-insensitively.
 */
export function getHeader(headers: Record<string, string>, name: string) {
	const target = name.toLowerCase()

	for (const [key, value] of Object.entries(headers)) {
		if (key.toLowerCase() === target) return value
	}

	return undefined
}

/**
 * Pick the effective nonce. A request CSP is authoritative, even when it has
 * no nonce, because it is the policy the browser will enforce.
 */
export function resolveNonce(
	requestCsp: string | null | undefined,
	configuredCsp: string | undefined,
) {
	if (requestCsp) return extractNonce(requestCsp)

	return extractNonce(configuredCsp)
}
