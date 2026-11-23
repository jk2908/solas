const SOLAS_RESPONSE = Symbol.for('solas.response')

/**
 * A response that opts into Solas request behaviour.
 */
export class SolasResponse extends globalThis.Response {
	readonly [SOLAS_RESPONSE] = true

	static json(data: unknown, init?: ResponseInit) {
		const headers = new Headers(init?.headers)
		if (!headers.has('content-type')) headers.set('content-type', 'application/json')

		return new SolasResponse(JSON.stringify(data), { ...init, headers })
	}

	static redirect(url: string | URL, status = 302) {
		return new SolasResponse(null, {
			status,
			headers: { location: String(url) },
		})
	}
}

/**
 * Create a response that opts into Solas request behaviour.
 */
export function Response(body?: BodyInit | null, init?: ResponseInit) {
	return new SolasResponse(body, init)
}

export namespace Response {
	export const json = SolasResponse.json
	export const redirect = SolasResponse.redirect
}

/**
 * Whether a response opted into Solas request behaviour.
 */
export function isSolasResponse(value: unknown): value is SolasResponse {
	return Boolean(
		value &&
		typeof value === 'object' &&
		SOLAS_RESPONSE in value &&
		value[SOLAS_RESPONSE],
	)
}
