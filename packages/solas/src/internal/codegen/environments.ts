import type { ConfiguredPluginConfig } from '../../types.js'
import * as Config from '../../config.js'
import { AUTOGEN_MSG, source } from './utils.js'

/**
 * Generates the RSC entry code.
 */
export function writeRSCEntry(_config: ConfiguredPluginConfig) {
	return source`
		${AUTOGEN_MSG}

		import { createRuntimeHandler } from '${Config.PKG_NAME}/env/rsc'

		import { manifest } from './manifest.js'
		import { importMap } from './maps.js'
		import { config } from './config.js'

		export default await createRuntimeHandler(config, manifest, importMap)

		if (import.meta.hot) {
			import.meta.hot.accept()
		}
	`
}

/**
 * Generates the Cloudflare Worker entry code.
 *
 * All of the Worker behaviour (installing the asset-backed store, lazily
 * building the RSC handler, caching per `env`) lives in `createWorker` from the
 * adapter so this stays pure wiring and is fully type-checked.
 */
export function writeCloudflareEntry() {
	return source`
		${AUTOGEN_MSG}

		import { createWorker } from '${Config.PKG_NAME}/cloudflare'

		import { manifest } from './manifest.js'
		import { importMap } from './maps.js'
		import { config } from './config.js'

		export default createWorker({ config, manifest, importMap })
	`
}

/**
 * Generates the SSR entry code.
 */
export function writeSSREntry() {
	return source`
		${AUTOGEN_MSG}

		export { prerender, resume, ssr } from '${Config.PKG_NAME}/env/ssr'
	`
}

/**
 * Generates the browser entry code.
 */
export function writeBrowserEntry() {
	return source`
		${AUTOGEN_MSG}

		import { browser } from '${Config.PKG_NAME}/env/browser'

		browser()
	`
}
