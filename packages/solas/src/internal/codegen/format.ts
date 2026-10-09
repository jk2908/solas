import { format as oxfmtFormat } from 'oxfmt'

const FORMAT_OPTIONS = {
	useTabs: true,
	tabWidth: 2,
	printWidth: 90,
	singleQuote: true,
	quoteProps: 'as-needed',
	trailingComma: 'all',
	semi: false,
	arrowParens: 'avoid',
	bracketSameLine: true,
	bracketSpacing: true,
} as const

/**
 * Format generated source before it is written to disk. Falls back to the
 * unformatted content when parsing fails so codegen never blocks on a
 * formatter error.
 */
export async function format(fileName: string, content: string) {
	const result = await oxfmtFormat(fileName, content, FORMAT_OPTIONS)

	if (result.errors.length > 0) return content

	return result.code
}
