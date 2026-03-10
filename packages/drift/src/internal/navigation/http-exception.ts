export type Payload = string | Record<string, unknown>
export type HttpExceptionStatusCode = 404 | (number & {})

type HttpExceptionOptions = {
	payload?: Payload
	cause?: unknown
}

const HTTP_EXCEPTION_NAME_MAP: Record<HttpExceptionStatusCode, string> = {
	404: 'NOT_FOUND',
} as const

/**
 * Create a HTTPException instance
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
