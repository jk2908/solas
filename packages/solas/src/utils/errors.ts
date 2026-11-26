import type { Solas } from '../solas.js'

/**
 * Stable identifiers for errors raised by Solas.
 *
 * All codes use SCREAMING_SNAKE_CASE with a `SOLAS_` prefix. Treat them as
 * public API: keep existing values stable, and add new values rather than
 * renaming old ones.
 */
export const ErrorCode = {
	ConfigInvalid: 'SOLAS_CONFIG_INVALID',
	VersionMissing: 'SOLAS_VERSION_MISSING',
	PackageNameMissing: 'SOLAS_PACKAGE_NAME_MISSING',
	PackageVersionMissing: 'SOLAS_PACKAGE_VERSION_MISSING',
	ViteConfigUnresolved: 'SOLAS_VITE_CONFIG_UNRESOLVED',
	ServerHandlerMissing: 'SOLAS_SERVER_HANDLER_MISSING',
	AssetsBindingMissing: 'SOLAS_ASSETS_BINDING_MISSING',
	AssetNotFound: 'SOLAS_ASSET_NOT_FOUND',
	ShellLayoutMissing: 'SOLAS_SHELL_LAYOUT_MISSING',
	RequestUrlInvalid: 'SOLAS_REQUEST_URL_INVALID',
	ArtifactPathInvalid: 'SOLAS_ARTIFACT_PATH_INVALID',
	ArtifactNameInvalid: 'SOLAS_ARTIFACT_NAME_INVALID',
	StaticPathInvalid: 'SOLAS_STATIC_PATH_INVALID',
	RscPayloadMissing: 'SOLAS_RSC_PAYLOAD_MISSING',
	ContextMissing: 'SOLAS_CONTEXT_MISSING',
	RevalidateOutsideAction: 'SOLAS_REVALIDATE_OUTSIDE_ACTION',
	BuildFailed: 'SOLAS_BUILD_FAILED',
	RouteConflict: 'SOLAS_ROUTE_CONFLICT',
	RouteGroupInvalid: 'SOLAS_ROUTE_GROUP_INVALID',
	AppShellMissing: 'SOLAS_APP_SHELL_MISSING',
	MiddlewareExportMissing: 'SOLAS_MIDDLEWARE_EXPORT_MISSING',
	CodegenInvalidIdentifier: 'SOLAS_CODEGEN_INVALID_IDENTIFIER',
	CodegenInvalidSpecifier: 'SOLAS_CODEGEN_INVALID_SPECIFIER',
	CodegenUnsupportedValue: 'SOLAS_CODEGEN_UNSUPPORTED_VALUE',
	ModuleExtensionUnsupported: 'SOLAS_MODULE_EXTENSION_UNSUPPORTED',
	ModuleParseFailed: 'SOLAS_MODULE_PARSE_FAILED',
	RouterExternalUrl: 'SOLAS_ROUTER_EXTERNAL_URL',
	RouterInvalidUrl: 'SOLAS_ROUTER_INVALID_URL',
	RouterInvalidPayload: 'SOLAS_ROUTER_INVALID_PAYLOAD',
	LinkMissingParam: 'SOLAS_LINK_MISSING_PARAM',
	LinkInvalidWildcard: 'SOLAS_LINK_INVALID_WILDCARD',
	HttpMissingEndpoint: 'SOLAS_HTTP_MISSING_ENDPOINT',
	HttpInvalidRouteGroup: 'SOLAS_HTTP_INVALID_ROUTE_GROUP',
	HttpMissingPageEntry: 'SOLAS_HTTP_MISSING_PAGE_ENTRY',
	HttpMiddlewareNextMultiple: 'SOLAS_HTTP_MIDDLEWARE_NEXT_MULTIPLE',
} as const

export type SolasErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode]

export type SolasErrorOptions = {
	/**
	 * A short suggestion that helps the reader fix the problem.
	 */
	hint?: string
	cause?: unknown
}

/**
 * Base class for errors raised by Solas.
 *
 * Messages are plain sentences with no `[scope]:` prefix. `code` is the stable
 * machine-readable identifier, and `hint` is the one-line fix for a human.
 */
export class SolasError extends Error implements Solas.Error {
	readonly code: SolasErrorCode
	readonly hint?: string

	constructor(code: SolasErrorCode, message: string, options: SolasErrorOptions = {}) {
		super(message, { cause: options.cause })

		this.name = 'SolasError'
		this.code = code
		this.hint = options.hint
	}

	toJSON() {
		return {
			name: this.name,
			code: this.code,
			message: this.message,
			...(this.hint ? { hint: this.hint } : {}),
		}
	}
}

/**
 * Check whether a value is a Solas error, including across bundles.
 */
export function isSolasError(error: unknown): error is Solas.Error {
	return (
		error instanceof SolasError ||
		(typeof error === 'object' &&
			error !== null &&
			'code' in error &&
			typeof error.code === 'string' &&
			error.code.startsWith('SOLAS_'))
	)
}

type FormatOptions = {
	/**
	 * Include the error message on the first line. Set to false when the
	 * logger has already printed it as the headline.
	 */
	includeMessage?: boolean
	/**
	 * Include stack frames.
	 */
	stack?: boolean
}

/**
 * Format an error for a log line. The message comes first, followed by the
 * code, hint, stack frames, and any nested `cause` errors.
 */
export function formatError(error: unknown, options: FormatOptions = {}) {
	if (!(error instanceof Error)) return String(error)

	const { includeMessage = true, stack = true } = options
	const lines: string[] = []

	if (includeMessage) {
		lines.push(isSolasError(error) ? error.message : `${error.name}: ${error.message}`)
	}

	if (isSolasError(error)) {
		lines.push(`code  ${error.code}`)

		if (error.hint) {
			lines.push(`hint  ${error.hint}`)
		}
	}

	// the stack repeats the message, so add only the frames
	if (stack && error.stack) {
		const frames = error.stack.split('\n').slice(1)
		if (frames.length > 0) lines.push(...frames)
	}

	if (error.cause instanceof Error) {
		lines.push('Caused by:')
		lines.push(
			...formatError(error.cause, { ...options, includeMessage: true })
				.split('\n')
				.map(line => `  ${line}`),
		)
	} else if (error.cause !== undefined) {
		lines.push(`Caused by: ${String(error.cause)}`)
	}

	return lines.join('\n')
}
