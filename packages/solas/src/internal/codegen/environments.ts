import { Solas } from '../../solas.js'
import { AUTOGEN_MSG, source } from './utils.js'

/**
 * Generates the RSC entry code
 */
export function writeRSCEntry() {
	return source`
		${AUTOGEN_MSG}

		import { createHandler } from '${Solas.Config.PKG_NAME}/env/rsc'
		import { Solas } from '${Solas.Config.PKG_NAME}'

		import { manifest } from './manifest.js'
		import { importMap } from './maps.js'
		import { config } from './config.js'

		const runtimeManifest = await Solas.Runtime.loadManifest(Solas.Config.OUT_DIR)

		export default createHandler(config, manifest, importMap, runtimeManifest)

		if (import.meta.hot) {
			import.meta.hot.accept()
		}
	`
}

/**
 * Generates the SSR entry code
 */
export function writeSSREntry() {
	return source`
		${AUTOGEN_MSG}

		export { prerender, resume, ssr } from '${Solas.Config.PKG_NAME}/env/ssr'
	`
}

/**
 * Generates the browser entry code
 */
export function writeBrowserEntry() {
	return source`
		${AUTOGEN_MSG}

		import { browser } from '${Solas.Config.PKG_NAME}/env/browser'

		browser()
	`
}
