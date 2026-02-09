import { $ } from 'bun'

import { Logger } from './logger'

const logger = new Logger()

export namespace Format {
	/**
	 * Format the code in a directory using Biome
	 * @param dir - the directory to format
	 * @returns void
	 */
	export async function run(dir: string) {
		try {
			const pattern = `${dir}/`
			await $`bunx @biomejs/biome format --write ${pattern}`.quiet()
		} catch (err) {
			logger.error(`[format:${dir}]`, err)
			throw err
		}
	}
}
