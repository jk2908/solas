import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { brotliCompress } from 'node:zlib'

export namespace Compress {
	const DEFAULT_CONCURRENCY = Math.max(1, Math.min(os.cpus().length, 8))

	async function collect(
		input: string,
		filter: (f: string) => boolean,
		output: string[] = [],
	) {
		const stat = await fs.stat(input)

		if (!stat.isDirectory()) {
			if (filter(input)) output.push(input)
			return output
		}

		for (const entry of await fs.readdir(input, { withFileTypes: true })) {
			const next = path.join(input, entry.name)

			if (entry.isDirectory()) {
				await collect(next, filter, output)
				continue
			}

			if (entry.isFile() && filter(next)) output.push(next)
		}

		return output
	}

	async function compress(input: string) {
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

		// return the input path plus a zero-copy Uint8Array view over the
		// compressed Buffer using its exact offset and length
		return {
			input,
			compressed: new Uint8Array(
				compressed.buffer,
				compressed.byteOffset,
				compressed.byteLength,
			),
		}
	}

	/**
	 * Compress a file or directory
	 */
	export async function* run(
		input: string,
		config: {
			filter?: (f: string) => boolean
		} = {},
	): AsyncGenerator<{
		input: string
		compressed: Uint8Array
	}> {
		const { filter = f => /\.(js|css|html|svg|json|txt)$/.test(f) } = config
		const targets = await collect(input, filter)

		if (!targets.length) return

		let index = 0

		const pending = new Map<
			number,
			Promise<{
				index: number
				value: { input: string; compressed: Uint8Array }
			}>
		>()

		function enqueue() {
			while (index < targets.length && pending.size < DEFAULT_CONCURRENCY) {
				const i = index++
				const value = targets[i]

				pending.set(
					i,
					compress(value).then(compressed => ({
						index: i,
						value: compressed,
					})),
				)
			}
		}

		enqueue()

		while (pending.size > 0) {
			const settled = await Promise.race(pending.values())

			pending.delete(settled.index)
			yield settled.value

			enqueue()
		}
	}
}
