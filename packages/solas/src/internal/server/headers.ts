import type { HeaderEntries, HeadersInput } from '../../types.js'
import { RequestContext } from '../env/request-context.js'
import { dynamic } from './dynamic.js'

/**
 * Get the request headers as a read-only map.
 * @returns A Promise resolving to a read-only map of request headers.
 */
export async function headers(): Promise<ReadonlyMap<string, string>> {
	await dynamic()

	const { req, cache, nonce } = RequestContext.use()
	// use request cache if possible to avoid reconstructing the map
	if (cache.headers) return cache.headers

	const map = new Map<string, string>()

	req.headers.forEach((value: string, key: string) => {
		map.set(key, value)
	})

	// expose the effective CSP nonce to server components under the same header
	// name used by the proxy pattern; a request header alone is not enough
	// because the nonce may come from the configured `headers` fallback
	map.delete('x-solas-nonce')
	map.delete('x-nonce')
	if (nonce) map.set('x-nonce', nonce)

	cache.headers = map

	return map
}

/**
 * Resolve the configured response headers once per request.
 *
 * The nonce extracted from a configured CSP and the headers applied to the
 * response must come from the same evaluation.
 */
export function createHeaderResolver(input: HeadersInput | undefined) {
	const cache = new WeakMap<Request, Promise<HeaderEntries>>()

	return function resolveHeaders(req: Request): Promise<HeaderEntries> {
		if (!input) return Promise.resolve({})
		if (typeof input !== 'function') return Promise.resolve(input)

		let pending = cache.get(req)

		if (!pending) {
			pending = Promise.resolve().then(() => input(req))
			cache.set(req, pending)
		}

		return pending
	}
}
