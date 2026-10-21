import { createHash } from 'node:crypto'

import type { CspHashes } from './server/csp.js'

const NAME_CHAR = /[a-zA-Z0-9:_-]/

/**
 * Collect CSP hash sources for every non-empty inline script and style in a
 * finished HTML document.
 *
 * The document must be complete: hashes are over the text the browser actually
 * parses, including any escaping already applied to inline scripts.
 */
export function collectCspHashes(html: string): CspHashes {
	const scripts = new Set<string>()
	const styles = new Set<string>()
	const lower = html.toLowerCase()

	let index = 0

	while (index < html.length) {
		const open = html.indexOf('<', index)

		if (open === -1) break

		if (html.startsWith('<!--', open)) {
			const end = html.indexOf('-->', open + 4)

			if (end === -1) break

			index = end + 3
			continue
		}

		if (html[open + 1] === '!' || html[open + 1] === '?') {
			const end = findTagEnd(html, open + 2)

			if (end === -1) break

			index = end + 1
			continue
		}

		const closing = html[open + 1] === '/'
		const nameStart = open + (closing ? 2 : 1)

		if (!NAME_CHAR.test(html[nameStart] ?? '')) {
			index = open + 1
			continue
		}

		let nameEnd = nameStart

		while (nameEnd < html.length && NAME_CHAR.test(html[nameEnd])) nameEnd++

		const name = lower.slice(nameStart, nameEnd)
		const tagEnd = findTagEnd(html, nameEnd)

		if (tagEnd === -1) break

		if (!closing && (name === 'script' || name === 'style')) {
			const end = findRawTextEnd(lower, tagEnd + 1, name)

			if (!end) break

			const content = html.slice(tagEnd + 1, end.start)

			if (content) {
				const source = digest(content.replace(/\r\n?/g, '\n'))
				const hashes = name === 'script' ? scripts : styles

				hashes.add(source)
			}

			index = end.end
			continue
		}

		index = tagEnd + 1
	}

	return {
		script: [...scripts],
		style: [...styles],
	}
}

function digest(value: string) {
	return `'sha256-${createHash('sha256').update(value).digest('base64')}'`
}

/**
 * Find the closing `>` of a tag while ignoring brackets inside quoted values.
 */
function findTagEnd(html: string, start: number) {
	let quote: string | undefined

	for (let index = start; index < html.length; index++) {
		const char = html[index]

		if (quote) {
			if (char === quote) quote = undefined
			continue
		}

		if (char === '"' || char === "'") {
			quote = char
			continue
		}

		if (char === '>') return index
	}

	return -1
}

/**
 * Find the end tag for a raw text element. Script and style bodies are not
 * parsed as HTML, so the first valid `</script` or `</style` wins.
 */
function findRawTextEnd(lower: string, start: number, name: 'script' | 'style') {
	const needle = `</${name}`
	let index = lower.indexOf(needle, start)

	while (index !== -1) {
		const next = lower[index + needle.length]

		if (next === undefined || next === '>' || next === '/' || /\s/.test(next)) {
			const end = findTagEnd(lower, index + needle.length)

			if (end !== -1) return { start: index, end: end + 1 }
		}

		index = lower.indexOf(needle, index + needle.length)
	}

	return undefined
}
