import { Solas } from '../../solas'

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
 */
function validate(url: string) {
	if (url.startsWith('//')) {
		throw new TypeError(
			`[${Solas.Config.NAME}] redirect() does not allow protocol-relative urls`,
		)
	}

	// reject urls with control characters to prevent header injection
	for (const char of url) {
		if (char === '\r' || char === '\n') {
			throw new TypeError(
				`[${Solas.Config.NAME}] redirect() does not allow control characters`,
			)
		}
	}

	// good
	if (url.startsWith('/')) return

	let parsed: URL

	try {
		parsed = new URL(url)
	} catch {
		throw new TypeError(
			`[${Solas.Config.NAME}] redirect() only supports relative paths or absolute http/https urls`,
		)
	}

	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		throw new TypeError(
			`[${Solas.Config.NAME}] redirect() only supports http:// and https:// urls`,
		)
	}
}

/**
 * Check if an error is a Redirect error
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
 * Throws a Redirect exc`eption to signal a redirect
 * @param url - the application-relative URL or absolute http/https URL to redirect to
 * @param status - the HTTP status code for the redirect, defaults to 307
 */
export function redirect(url: string, status: RedirectStatusCode = 307): never {
	validate(url)
	throw new Redirect(url, status)
}
