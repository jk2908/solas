import type { SolasErrorCode } from './utils/errors.js'

import type { HttpRouter } from './internal/http-router/router.js'
import type { HttpException } from './internal/navigation/http-exception.js'
import * as Config from './config.js'

type NativeRequest = Request
type NativeError = Error

/**
 * Framework types.
 */
export namespace Solas {
	export interface Routes {}

	export interface Error extends NativeError {
		readonly code: SolasErrorCode
		readonly hint?: string
	}

	export type RequestMeta = {
		error?: HttpException | NativeError
		action?: boolean
		match: HttpRouter.Match | null
		parsedFormData?: FormData | null
		url?: URL
	}

	export type Request = NativeRequest & {
		[Config.REQUEST_META_KEY]: RequestMeta
	}

	export type ErrorCode = SolasErrorCode
}
