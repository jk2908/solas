import type { Manifest } from '../../types'

import { Solas } from '../../solas'

import { AUTOGEN_MSG } from './utils'

/**
 * Generates the code to create an exported manifest object
 */
export function writeManifest(manifest: Manifest) {
	return `
    ${AUTOGEN_MSG}

    import type { Manifest } from '${Solas.Config.PKG_NAME}'

    export const manifest = 
      ${JSON.stringify(manifest, null, 2)} as const satisfies Manifest
  `.trim()
}
