import { $ } from 'bun'

import type { BuildContext } from '../../types'

export namespace Format {
	/**
	 * Format the code in a directory using Biome
	 * @param dir - the directory to format
	 * @param buildContext - the build context
	 * @returns void
	 */
	export async function run(dir: string, buildContext: BuildContext) {
		try {
			const pattern = `${dir}/`
			await $`bunx @biomejs/biome format --write ${pattern}`.quiet()
		} catch (err) {
			buildContext.logger.error(`[format:${dir}]`, err)
			throw err
		}
	}
}
