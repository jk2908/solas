export type Payload = string | Record<string, unknown>

type HttpExceptionOptions = {
	payload?: Payload
	cause?: unknown
}

export type HttpExceptionStatusCode = 404 | (number & {})

const HTTP_EXCEPTION_NAME_MAP: Record<HttpExceptionStatusCode, string> = {
	404: 'NOT_FOUND',
} as const

/**
 * Create a HTTPException instance
 * @param message - the message
 * @param status - the status code of the error
 * @param opts - the options
 * @param opts.payload - the payload
 * @param opts.cause - the cause
 */
export class HttpException extends Error {
	payload?: Payload
	digest?: string

	constructor(
		public readonly status: HttpExceptionStatusCode,
		public override readonly message: string,
		opts?: HttpExceptionOptions,
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
 * @description uses the digest property to work across server/client boundaries
 * @param err - the error to check
 * @returns true if the error is an HTTPException, false otherwise
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
 * Throw an HTTPException
 * @param status - the status code of the error
 * @param message - the message
 * @param opts - the options
 * @param opts.payload - the payload
 * @param opts.cause - the cause
 * @throws a HTTPException with the given status and options
 */
export function abort(
	status: HttpExceptionStatusCode,
	message: string,
	opts?: {
		payload?: Payload
		cause?: unknown
	},
): never {
	throw new HttpException(status, message, {
		payload: opts?.payload,
		cause: opts?.cause,
	})
}
