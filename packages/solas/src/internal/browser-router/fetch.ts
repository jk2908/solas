import * as Config from '../../config.js'
import * as Events from '../../events.js'

/**
 * Fetch a resource and apply any Solas revalidation metadata from a route
 * handler response.
 */
export async function solasFetch(input: RequestInfo | URL, init?: RequestInit) {
	const response = await globalThis.fetch(input, init)
	const header = response.headers.get(Config.INVALIDATED_PATHS_HEADER)

	if (header && typeof window !== 'undefined') {
		try {
			const paths = JSON.parse(header)
			window.dispatchEvent(new CustomEvent(Events.REVALIDATE, { detail: { paths } }))
		} catch {
			// malformed metadata should not break the response
		}
	}

	return response
}
