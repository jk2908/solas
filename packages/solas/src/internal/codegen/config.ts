import type { PluginConfig } from '../../types'

import { Solas } from '../../solas'

import { AUTOGEN_MSG } from './utils'

/**
 * Generates the code to create an exported config object
 */
export function writeConfig(config: PluginConfig) {
	return `
    ${AUTOGEN_MSG}

    import type { PluginConfig } from '${Solas.Config.PKG_NAME}'
    
    export const config = 
      ${JSON.stringify(config, null, 2)} as const satisfies PluginConfig
  `.trim()
}
