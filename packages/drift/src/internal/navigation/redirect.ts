export type RedirectStatusCode = 301 | 302 | 307 | 308

/**
 * Redirect exception class to signal a redirect
 */
export class Redirect extends Error {
	digest?: string

	constructor(
		public readonly url: string,
		public readonly status: RedirectStatusCode = 307,
	) {
		super(`Redirecting to ${url} with status ${status}`)

		this.name = 'Redirect'
		this.digest = `${REDIRECT_DIGEST_PREFIX}:${status}:${url}`
	}
}

export const REDIRECT_DIGEST_PREFIX = 'REDIRECT'

/**
 * Validate a url for use in the redirect() function
 * @param url - the url to validate
 * @returns void if the url is valid
 * @throws an error if the url is invalid
 */
function validate(url: string) {
	if (url.startsWith('//')) {
		throw new Error('[drift] redirect() does not allow protocol-relative urls')
	}

	// reject urls with control characters to prevent header injection
	for (const char of url) {
		if (char === '\r' || char === '\n') {
			throw new Error('[drift] redirect() does not allow control characters')
		}
	}

	// good
	if (url.startsWith('/')) return

	let parsed: URL

	try {
		parsed = new URL(url)
	} catch {
		throw new Error(
			'[drift] redirect() only supports application-relative paths or absolute http/https urls',
		)
	}

	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		throw new Error('[drift] redirect() only supports http:// and https:// urls')
	}
}

/**
 * Check if an error is a Redirect error
 * @description uses the digest property to work across server/client boundaries
 * @param err - the error to check
 * @returns true if the error is a Redirect error, false otherwise
 */
export function isRedirect(err: unknown): err is Redirect {
	return (
		typeof err === 'object' &&
		err !== null &&
		'digest' in err &&
		typeof err.digest === 'string' &&
		err.digest.startsWith(REDIRECT_DIGEST_PREFIX)
	)
}

/**
 * Throws a Redirect exception to signal a redirect
 * @param url - the application-relative URL or absolute http/https URL to redirect to
 * @param status - the HTTP status code for the redirect, defaults to 307
 */
export function redirect(url: string, status: RedirectStatusCode = 307): never {
	validate(url)
	throw new Redirect(url, status)
}
