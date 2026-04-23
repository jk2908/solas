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
		...('status' in error ? { status: error.status } : {}),
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
