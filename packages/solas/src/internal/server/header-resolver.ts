import type { HeaderEntries, HeadersInput } from '../../types.js'

/**
 * Resolve the configured response headers once per request.
 *
 * The nonce extracted from a configured CSP and the headers applied to the
 * response must come from the same evaluation.
 */
export function createHeaderResolver(headers: HeadersInput | undefined) {
	const cache = new WeakMap<Request, Promise<HeaderEntries>>()

	return function resolveHeaders(req: Request): Promise<HeaderEntries> {
		if (!headers) return Promise.resolve({})
		if (typeof headers !== 'function') return Promise.resolve(headers)

		let pending = cache.get(req)

		if (!pending) {
			pending = Promise.resolve().then(() => headers(req))
			cache.set(req, pending)
		}

		return pending
	}
}
