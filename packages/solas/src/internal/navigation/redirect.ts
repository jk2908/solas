import * as Config from '../../config.js'

export type RedirectStatusCode = 301 | 302 | 307 | 308

export type RedirectLike = Pick<Error, 'name' | 'message' | 'stack'> &
	Partial<Pick<Redirect, 'digest' | 'status' | 'url'>>

function isRedirectStatusCode(value: unknown): value is RedirectStatusCode {
	return value === 301 || value === 302 || value === 307 || value === 308
}

/**
 * Redirect exception class to signal a redirect.
 */
export class Redirect extends Error {
	digest?: string

	constructor(
		public readonly url: string,
		public readonly status: RedirectStatusCode = 307,
	) {
		validate(url)

		super(`Redirecting to ${url} with status ${status}`)

		this.name = 'Redirect'
		this.digest = `${REDIRECT_DIGEST_PREFIX}:${status}:${url}`
	}
}

export const REDIRECT_DIGEST_PREFIX = 'REDIRECT'

/**
 * Validate a url for use in the redirect() function.
 */
function validate(url: string) {
	if (url.startsWith('//')) {
		throw new TypeError(
			`[${Config.NAME}] redirect() does not allow protocol-relative urls`,
		)
	}

	// reject urls with control characters to prevent header injection
	for (const char of url) {
		if (char === '\r' || char === '\n') {
			throw new TypeError(`[${Config.NAME}] redirect() does not allow control characters`)
		}
	}

	// good
	if (url.startsWith('/')) return

	let parsed: URL

	try {
		parsed = new URL(url)
	} catch {
		throw new TypeError(
			`[${Config.NAME}] redirect() only supports relative paths or absolute http/https urls`,
		)
	}

	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		throw new TypeError(
			`[${Config.NAME}] redirect() only supports http:// and https:// urls`,
		)
	}
}

/**
 * Check if an error is a Redirect error.
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

export function toRedirect(err: unknown): Redirect {
	if (err instanceof Redirect) return err

	let digestStatus: RedirectStatusCode | undefined
	let digestUrl: string | undefined

	if (
		typeof err === 'object' &&
		err !== null &&
		'digest' in err &&
		typeof err.digest === 'string'
	) {
		const [type, rawStatus, ...rawUrlParts] = err.digest.split(':')
		const status = Number(rawStatus)

		if (type === REDIRECT_DIGEST_PREFIX && isRedirectStatusCode(status)) {
			digestStatus = status
			digestUrl = rawUrlParts.join(':')
		}
	}

	const status =
		digestStatus ??
		(typeof err === 'object' &&
		err !== null &&
		'status' in err &&
		isRedirectStatusCode(err.status)
			? err.status
			: 307)

	const url =
		digestUrl ||
		(typeof err === 'object' &&
		err !== null &&
		'url' in err &&
		typeof err.url === 'string'
			? err.url
			: undefined)

	if (!url) {
		throw new TypeError(`[${Config.NAME}] failed to reconstruct redirect`)
	}

	return new Redirect(url, status)
}

export function toRedirectLike(error: Redirect | Error): RedirectLike {
	return {
		name: error.name,
		message: error.message,
		...('digest' in error && typeof error.digest === 'string'
			? { digest: error.digest }
			: {}),
		...('url' in error && typeof error.url === 'string' ? { url: error.url } : {}),
		...('status' in error && isRedirectStatusCode(error.status)
			? { status: error.status }
			: {}),
	}
}

/**
 * Throws a Redirect exception to signal a redirect.
 * @param url - The application-relative URL or absolute http/https URL to redirect to.
 * @param status - The HTTP status code for the redirect, defaults to 307.
 */
export function redirect(url: string, status: RedirectStatusCode = 307): never {
	throw new Redirect(url, status)
}
