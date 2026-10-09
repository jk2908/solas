import type { Manifest } from '../../types.js'
import * as Config from '../../config.js'
import { AUTOGEN_MSG, source, toSourceLiteral } from './utils.js'

/**
 * Generates the code to create an exported manifest object.
 */
export function writeManifest(manifest: Manifest) {
	return source`
		${AUTOGEN_MSG}

		import type { Manifest } from '${Config.PKG_NAME}'

		export const manifest = ${toSourceLiteral(manifest)} as const satisfies Manifest
	`
}
