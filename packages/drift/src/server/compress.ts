import fs from 'node:fs/promises'
import path from 'node:path'
import { brotliCompress } from 'node:zlib'

import type { BuildContext } from '../types'

export namespace Compress {
	/**
	 * Compress a file or directory
	 * @param input - the input file or directory
	 * @param ctx - the build context
	 * @param config - the config options
	 * @param config.filter - a filter function to determine which files to compress
	 * @returns an async generator that yields the compressed files
	 * @throws if an error occurs during compression
	 */
	export async function* run(
		input: string,
		ctx: BuildContext,
		config: {
			filter?: (f: string) => boolean
		} = {},
	): AsyncGenerator<{
		input: string
		compressed: Uint8Array
	}> {
		try {
			const { filter = f => /\.(js|css|html|svg|json|txt)$/.test(f) } = config
			const stat = await fs.stat(input)

			if (stat.isDirectory()) {
				for (const entry of await fs.readdir(input)) {
					yield* run(path.join(input, entry), ctx, config)
				}
			} else if (filter(input)) {
				const file = Bun.file(input)
				const buffer = Buffer.from(await file.arrayBuffer())

				const compressed: Buffer = await new Promise((fulfill, reject) => {
					brotliCompress(buffer, (err, res) => {
						if (err) {
							reject(err)
						} else {
							fulfill(res)
						}
					})
				})

				yield {
					input,
					compressed: new Uint8Array(compressed.buffer),
				}
			}
		} catch (err) {
			ctx.logger.error(`[compress*:${input}]`, err)
			throw err
		}
	}
}
