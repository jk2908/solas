import type { Manifest } from '../../types.js'
import { Solas } from '../../solas.js'
import { AUTOGEN_MSG, source, toSourceLiteral } from './utils.js'

/**
 * Generates the code to create an exported manifest object
 */
export function writeManifest(manifest: Manifest) {
	return source`
		${AUTOGEN_MSG}

		import type { Manifest } from '${Solas.Config.PKG_NAME}'

		export const manifest = ${toSourceLiteral(manifest)} as const satisfies Manifest
	`
}
