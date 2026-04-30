export namespace HttpException {
	export type Payload = string | Record<string, unknown>
	export type StatusCode = 401 | 403 | 404 | 500

	export type Options = {
		payload?: Payload
		cause?: unknown
	}
}

export const HTTP_EXCEPTION_NAME_MAP: Record<HttpException.StatusCode, string> = {
	401: 'UNAUTHORIZED',
	403: 'FORBIDDEN',
	404: 'NOT_FOUND',
	500: 'INTERNAL_SERVER_ERROR',
} as const

export type HttpExceptionLike = Pick<Error, 'name' | 'message' | 'stack'> &
	Partial<Pick<HttpException, 'digest' | 'payload' | 'status'>>

/**
 * An exception representing an HTTP error, with an optional payload
 * and cause
 */
export class HttpException extends Error {
	payload?: HttpException.Payload
	digest?: string

	constructor(
		public readonly status: HttpException.StatusCode,
		public override readonly message: string,
		opts?: HttpException.Options,
	) {
		super(message, { cause: opts?.cause })

		this.name = HTTP_EXCEPTION_NAME_MAP[status]
		this.payload = opts?.payload
		this.digest = `${HTTP_EXCEPTION_DIGEST_PREFIX}:${status}:${message}`
	}
}

export const HTTP_EXCEPTION_DIGEST_PREFIX = 'HTTP_EXCEPTION'

/**
 * Status type predicate
 */
function isStatusCode(value: unknown): value is HttpException.StatusCode {
	return value === 401 || value === 403 || value === 404 || value === 500
}

/**
 * Check if an error is an HTTPException
 */
export function isHttpException(err: unknown): err is HttpException {
	return (
		typeof err === 'object' &&
		err !== null &&
		'digest' in err &&
		typeof err.digest === 'string' &&
		err.digest.startsWith(HTTP_EXCEPTION_DIGEST_PREFIX)
	)
}

/**
 * Convert any error into an HttpException
 */
export function toHttpException(err: unknown): HttpException {
	if (err instanceof HttpException) return err

	let digestStatus: HttpException.StatusCode | undefined
	let digestMessage: string | undefined

	if (
		typeof err === 'object' &&
		err !== null &&
		'digest' in err &&
		typeof err.digest === 'string'
	) {
		const [type, rawStatus, ...rawMessageParts] = err.digest.split(':')
		const status = Number(rawStatus)

		if (type === HTTP_EXCEPTION_DIGEST_PREFIX && isStatusCode(status)) {
			digestStatus = status
			digestMessage = rawMessageParts.join(':')
		}
	}

	const status =
		digestStatus ??
		(typeof err === 'object' &&
		err !== null &&
		'status' in err &&
		isStatusCode(err.status)
			? err.status
			: 500)

	const message =
		digestMessage ||
		(typeof err === 'object' &&
		err !== null &&
		'message' in err &&
		typeof err.message === 'string'
			? err.message
			: 'Internal Server Error')

	return new HttpException(status, message, { cause: err })
}

/**
 * Convert an HttpException or any Error into a plain object that can be
 * safely serialised
 */
export function toHttpExceptionLike(error: HttpException | Error): HttpExceptionLike {
	return {
		name: error.name,
		message: error.message,
		stack: error.stack,
		...('digest' in error && typeof error.digest === 'string'
			? { digest: error.digest }
			: {}),
		...('payload' in error && error.payload !== undefined
			? { payload: error.payload }
			: {}),
		...('status' in error && isStatusCode(error.status) ? { status: error.status } : {}),
	}
}

/**
 * Throw an HTTPException
 */
export function abort(
	status: HttpException.StatusCode,
	message: string,
	opts?: {
		payload?: HttpException.Payload
		cause?: unknown
	},
): never {
	throw new HttpException(status, message, {
		payload: opts?.payload,
		cause: opts?.cause,
	})
}
