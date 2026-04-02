import { Solas } from '../../solas'

import { AUTOGEN_MSG } from './utils'

/**
 * Generates the RSC entry code
 */
export function writeRSCEntry() {
	return `
    ${AUTOGEN_MSG}

    import { createHandler } from '${Solas.Config.PKG_NAME}/env/rsc'
    import { Prerender } from '${Solas.Config.PKG_NAME}/prerender'
    import { Solas } from '${Solas.Config.PKG_NAME}'

    import { manifest } from './manifest'
    import { importMap } from './maps'
    import { config } from './config'

    const artifactManifest = await Prerender.Artifact.loadManifest(Solas.Config.OUT_DIR)

    export default createHandler(config, manifest, importMap, artifactManifest)

    import.meta.hot?.accept()
  `.trim()
}

/**
 * Generates the SSR entry code
 */
export function writeSSREntry() {
	return `
    ${AUTOGEN_MSG}
    
    export { prerender, resume, ssr } from '${Solas.Config.PKG_NAME}/env/ssr'
  `.trim()
}

/**
 * Generates the browser entry code
 */
export function writeBrowserEntry() {
	return `
    ${AUTOGEN_MSG}

    import { browser } from '${Solas.Config.PKG_NAME}/env/browser'

    browser()
  `.trim()
}
