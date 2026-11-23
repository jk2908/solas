import * as Config from '../../config.js'
import * as Events from '../../events.js'

const OBSERVED = Symbol.for(`${Config.SLUG}.fetch`)

/**
 * Observe route handler responses for Solas revalidation metadata.
 */
export function observeFetch() {
	if (typeof window === 'undefined') return
	if (Reflect.get(window, OBSERVED)) return

	const nativeFetch = window.fetch.bind(window)

	const patchedFetch: typeof window.fetch = Object.assign(
		async (input: RequestInfo | URL, init?: RequestInit) => {
			const response = await nativeFetch(input, init)
			const header = response.headers.get(Config.INVALIDATED_PATHS_HEADER)

			if (header) {
				try {
					const paths = JSON.parse(header)
					window.dispatchEvent(new CustomEvent(Events.REVALIDATE, { detail: { paths } }))
				} catch {
					// malformed metadata should not break the response
				}
			}

			return response
		},
		{ preconnect: window.fetch.preconnect },
	)

	window.fetch = patchedFetch
	Reflect.set(window, OBSERVED, true)
}
