import { parseSync } from 'oxc-parser'

export type SourceLoader = 'js' | 'jsx' | 'ts' | 'tsx'

/**
 * Pick the Oxc parser language that matches a source file extension.
 */
export function getSourceLoader(filePath: string) {
	const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase()

	if (ext === '.js' || ext === '.mjs' || ext === '.cjs') return 'js'
	if (ext === '.jsx') return 'jsx'
	if (ext === '.ts' || ext === '.mts' || ext === '.cts') return 'ts'
	if (ext === '.tsx') return 'tsx'

	return null
}

export function parseModuleSource(filePath: string, source: string) {
	const lang = getSourceLoader(filePath)

	if (!lang) return null

	return parseSync(filePath, source, {
		lang,
		sourceType: 'module',
		preserveParens: false,
	})
}
