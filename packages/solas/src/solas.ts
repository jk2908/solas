import type { cloudflare as cloudflareVitePlugin } from '@cloudflare/vite-plugin'

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

	export type StaticAdapterOptions = {
		/**
		 * Directory, relative to the project root, the static site is written to.
		 *
		 * @default 'build'
		 */
		outDir?: string
	}

	export type CloudflareAdapterOptions = {
		/**
		 * Options forwarded to `@cloudflare/vite-plugin`.
		 */
		cloudflare?: Parameters<typeof cloudflareVitePlugin>[0]
	}

	export type VercelAdapterOptions = {
		/**
		 * Directory, relative to the project root, the Vercel Build Output is
		 * written to.
		 *
		 * @default '.vercel/output'
		 */
		outDir?: string
		/**
		 * Node.js runtime used by the generated Vercel Function.
		 *
		 * @default 'nodejs22.x'
		 */
		runtime?: string
		/**
		 * Maximum duration of the generated Vercel Function, in seconds.
		 */
		maxDuration?: number
	}
}
