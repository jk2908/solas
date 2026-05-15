import type { PluginConfig } from '../../types.js'
import { HttpException } from '../navigation/http-exception.js'

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const TRUSTED_FETCH_SITES = new Set(['same-origin', 'none'])

export type CsrfConfig = Pick<PluginConfig, 'trustedOrigins' | 'url'>

/**
 * Reduce an origin-like value to just its origin for comparison
 */
function toOrigin(value: string | null) {
	if (!value) return null

	try {
		// csrf only cares which origin sent the request, not its path or query
		return new URL(value).origin
	} catch {
		return null
	}
}

/**
 * Enforce the CSRF policy for one request
 */
export function enforce(req: Request, config: CsrfConfig = {}) {
	// only unsafe methods can mutate state, so safe methods bypass the guard
	if (!UNSAFE_METHODS.has(req.method.toUpperCase())) return

	// first trust the browser's own source headers when they are present
	const sourceOrigin =
		toOrigin(req.headers.get('origin')) ?? toOrigin(req.headers.get('referer'))

	if (sourceOrigin) {
		const origins = new Set<string>()
		const forwardedProtocol = takeFirst(req.headers.get('x-forwarded-proto'))

		let protocol: string | null | undefined

		if (forwardedProtocol === 'http' || forwardedProtocol === 'https') {
			protocol = forwardedProtocol
		} else {
			try {
				// otherwise fall back to the protocol on the request url we received
				protocol = new URL(req.url).protocol.replace(/:$/, '')
			} catch {
				protocol = null
			}
		}

		// allow the current request origin and any configured public origin
		const requestOrigin = toOrigin(req.url)
		if (requestOrigin) origins.add(requestOrigin)

		const configuredOrigin = toOrigin(config.url ?? null)
		if (configuredOrigin) origins.add(configuredOrigin)

		// also allow host-based origins so proxied deployments still match the public site
		const forwardedHostOrigin = toHostOrigin(
			takeFirst(req.headers.get('x-forwarded-host')),
			protocol,
		)
		if (forwardedHostOrigin) origins.add(forwardedHostOrigin)

		const hostOrigin = toHostOrigin(takeFirst(req.headers.get('host')), protocol)
		if (hostOrigin) origins.add(hostOrigin)

		// add any cross-origin browser sites the config explicitly trusts
		for (const value of config.trustedOrigins ?? []) {
			const origin = toOrigin(value)
			if (origin) origins.add(origin)
		}

		if (origins.has(sourceOrigin)) return
	}

	// if origin and referer are missing, fall back to fetch metadata
	const fetchSite = req.headers.get('sec-fetch-site')?.toLowerCase()
	if (fetchSite && TRUSTED_FETCH_SITES.has(fetchSite)) return

	// if the browser sent no source hints at all, treat it like a non-browser client
	if (!sourceOrigin && !fetchSite) return

	throw new HttpException(403, 'Cross-site unsafe requests are forbidden')
}

/**
 * Get the first value from a forwarded-style header chain
 */
export function takeFirst(value: string | null | undefined) {
	if (!value) return null

	// use the client-facing value, not a later proxy hop
	const first = value.split(',')[0]?.trim()
	return first || null
}

/**
 * Build an origin from host-style headers when there is no full origin value
 */
export function toHostOrigin(
	host: string | null | undefined,
	protocol: string | null | undefined,
) {
	if (!host || !protocol) return null

	try {
		// this lets host and forwarded-host compare against trusted origins too
		return new URL(`${protocol}://${host}`).origin
	} catch {
		return null
	}
}
