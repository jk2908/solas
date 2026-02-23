import type { PluginConfig } from '../types'

import { Config } from '../config'

import { AUTOGEN_MSG } from './utils'

/**
 * Generates the code to create an exported config object
 * @param config<PluginConfig> - the plugin configuration
 * @returns the stringified code
 */
export function writeConfig(config: PluginConfig) {
	return `
    ${AUTOGEN_MSG}

    import type { PluginConfig } from '${Config.PKG_NAME}'
    
    export const config = 
      ${JSON.stringify(config, null, 2)} as const satisfies PluginConfig
  `.trim()
}
