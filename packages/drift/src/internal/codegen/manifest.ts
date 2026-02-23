import type { Manifest } from '../../types'

import { Drift } from '../../drift'
import { AUTOGEN_MSG } from './utils'

/**
 * Generates the code to create an exported manifest object
 * @param manifest - the application manifest
 * @returns the stringified code
 */
export function writeManifest(manifest: Manifest) {
	return `
    ${AUTOGEN_MSG}

    import type { Manifest } from '${Drift.Config.PKG_NAME}'

    export const manifest = 
      ${JSON.stringify(manifest, null, 2)} as const satisfies Manifest
  `.trim()
}
