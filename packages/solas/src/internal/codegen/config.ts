import type { PluginConfig } from '../../types.js'
import { Solas } from '../../solas.js'
import { AUTOGEN_MSG, toSourceLiteral } from './utils.js'

/**
 * Generates the code to create an exported config object
 */
export function writeConfig(config: PluginConfig) {
	return `
		${AUTOGEN_MSG}

		import type { PluginConfig } from '${Solas.Config.PKG_NAME}'
		import { Logger } from '${Solas.Config.PKG_NAME}/utils/logger'

		const config = ${toSourceLiteral(config)} as const satisfies PluginConfig

		if (config.logger?.level) Logger.defaultLevel = config.logger.level

		export { config }
	`.trim()
}
