/**
 * The CSP nonce for the current document.
 *
 * RSC navigations are part of the same document as the initial page load, so
 * they must render with the same nonce. Read it from a framework script or
 * style tag that already carries it.
 *
 * Use the `.nonce` property rather than a normal attribute: browsers hide the
 * nonce content attribute after parsing so CSS cannot read it.
 */
export function getDocumentNonce() {
	if (typeof document === 'undefined') return

	const element = document.querySelector<HTMLScriptElement | HTMLStyleElement>(
		'script[nonce], style[nonce]',
	)

	return element?.nonce || element?.getAttribute('nonce') || undefined
}
