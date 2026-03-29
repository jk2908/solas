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
	 * Format a file in-place using oxfmt with our preferred code style
	 */
	export async function run(filePath: string) {
		try {
			const ext = path.extname(filePath).toLowerCase()

			if (!SUPPORTED_EXTENSIONS.has(ext)) {
				logger.warn(`[format] Skipping unsupported file type: ${filePath}`)
				return
			}

			const file = Bun.file(filePath)
			const source = await file.text()

			const options: FormatOptions =
				ext === '.json' ? { ...BASE_OPTIONS, trailingComma: 'none' } : BASE_OPTIONS

			const result = await format(filePath, source, options)

			if (result.errors.length > 0) {
				logger.warn(`[format] oxfmt failed for ${filePath}: ${result.errors[0]?.message}`)
				return
			}

			if (result.code === source) return

			await Bun.write(filePath, result.code)
			logger.info(`[format] Formatted file: ${filePath}`)
		} catch (err) {
			logger.error(`[format] Failed to format file: ${filePath}`, err)
		}
	}
}
