import path from 'node:path'

import { format, type FormatOptions } from 'oxfmt'

import { Logger } from './logger'

const logger = new Logger()

const BASE_OPTIONS: FormatOptions = {
	useTabs: true,
	tabWidth: 2,
	printWidth: 90,
	singleQuote: true,
	jsxSingleQuote: false,
	quoteProps: 'as-needed',
	trailingComma: 'all',
	semi: false,
	arrowParens: 'avoid',
	bracketSameLine: true,
	bracketSpacing: true,
	endOfLine: 'lf',
}

const SUPPORTED_EXTENSIONS = new Set([
	'.js',
	'.jsx',
	'.ts',
	'.tsx',
	'.mjs',
	'.cjs',
	'.mts',
	'.cts',
	'.json',
	'.jsonc',
	'.json5',
	'.css',
	'.scss',
	'.less',
	'.md',
	'.mdx',
	'.html',
	'.yml',
	'.yaml',
	'.toml',
])

export namespace Format {
	/**
	 * Format the code in a directory using Oxfmt
	 * @param dir - the directory to format
	 * @returns void
	 */
	export async function run(dir: string) {
		try {
			const glob = new Bun.Glob('**/*')

			for await (const rel of glob.scan({ cwd: dir, onlyFiles: true })) {
				const filePath = path.join(dir, rel)
				const ext = path.extname(filePath).toLowerCase()

				if (!SUPPORTED_EXTENSIONS.has(ext)) continue

				const file = Bun.file(filePath)
				const source = await file.text()

				const options: FormatOptions =
					ext === '.json' ? { ...BASE_OPTIONS, trailingComma: 'none' } : BASE_OPTIONS

				const result = await format(filePath, source, options)

				if (result.errors.length > 0) {
					logger.error(
						`[format:${dir}] oxfmt failed for ${filePath}: ${result.errors[0]?.message}`,
					)
				}

				if (result.code !== source) await Bun.write(filePath, result.code)
			}
		} catch (err) {
			logger.error(`[format:${dir}]`, err)
			throw err
		}
	}
}
