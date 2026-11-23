import * as Config from '../../config.js'

export type InvalidatedPath = {
	path: string
	scope: 'page' | 'layout'
}

export function readInvalidatedPaths(value: unknown) {
	if (!Array.isArray(value)) return undefined

	const paths: InvalidatedPath[] = []

	for (const item of value) {
		if (!item || typeof item !== 'object') continue

		const { path, scope } = item as { path?: unknown; scope?: unknown }
		if (typeof path !== 'string') continue
		if (scope !== 'page' && scope !== 'layout') continue

		paths.push({ path, scope })
	}

	return paths
}

/**
 * Share cache invalidations with other tabs.
 */
export function createRevalidationChannel(
	onInvalidate: (paths?: InvalidatedPath[]) => void,
) {
	if (typeof BroadcastChannel === 'undefined') {
		return {
			broadcast(_paths?: InvalidatedPath[]) {},
			close() {},
		}
	}

	const channel = new BroadcastChannel(`${Config.SLUG}revalidate`)

	function onMessage(e: MessageEvent<{ paths?: unknown }>) {
		onInvalidate(readInvalidatedPaths(e.data?.paths))
	}

	channel.addEventListener('message', onMessage)

	return {
		broadcast(paths?: InvalidatedPath[]) {
			channel.postMessage({ paths })
		},
		close() {
			channel.removeEventListener('message', onMessage)
			channel.close()
		},
	}
}
