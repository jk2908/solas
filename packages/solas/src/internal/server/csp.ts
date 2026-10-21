import type { CspDirectives } from '../../types.js'

/**
 * Resolve the nonce for a request.
 *
 * On RSC and action requests a document nonce supplied by the client wins.
 * Otherwise the request CSP is authoritative, even when it has no nonce, and
 * configured headers are the fallback.
 */
export function resolveNonce(
	requestCsp: string | null | undefined,
	configuredHeaders: Record<string, string>,
	clientNonce?: string | null,
) {
	if (clientNonce) return clientNonce
	if (requestCsp) return extract(requestCsp)

	return extract(new Headers(configuredHeaders).get('content-security-policy'))
}

function extract(csp: string | null | undefined) {
	return csp?.match(/'nonce-([^']+)'/)?.[1] || undefined
}

export type CspHashes = {
	script: string[]
	style: string[]
}

type Directive = {
	name: string
	tokens: string[]
}

const KEYWORDS = new Set([
	'self',
	'none',
	'unsafe-inline',
	'unsafe-eval',
	'unsafe-hashes',
	'strict-dynamic',
	'report-sample',
	'wasm-unsafe-eval',
	'inline-speculation-rules',
	'unsafe-allow-redirects',
])

/**
 * Build a CSP value from structured directives, adding a nonce and any
 * prerender hashes that apply to the response.
 */
export function buildCsp(directives: CspDirectives, nonce?: string, hashes?: CspHashes) {
	const parsed = Object.entries(directives).map(([name, values]) => ({
		name: name.toLowerCase(),
		// keywords such as `self` can be written without quotes; hosts and schemes
		// stay as written.
		tokens: values.map(value => {
			const token = value.trim()

			if (token.length >= 2 && token.startsWith("'") && token.endsWith("'")) {
				return token
			}
			if (KEYWORDS.has(token.toLowerCase())) return `'${token.toLowerCase()}'`
			if (/^(sha256|sha384|sha512|nonce)-/.test(token)) return `'${token}'`

			return token
		}),
	}))

	if (nonce) {
		const token = `'nonce-${nonce}'`

		addNonce(parsed, ['script-src-elem', 'script-src', 'default-src'], token)
		addNonce(parsed, ['style-src-elem', 'style-src', 'default-src'], token)
	}

	const csp = parsed.map(formatDirective).join('; ')

	return hashes ? addCspHashes(csp, hashes) : csp
}

function addNonce(directives: Directive[], names: string[], token: string) {
	const directive = names
		.map(name => directives.find(candidate => candidate.name === name))
		.find(Boolean)

	if (!directive) return
	if (
		directive.tokens.some(
			value =>
				value.toLowerCase() === "'unsafe-inline'" || value.toLowerCase() === "'none'",
		)
	) {
		return
	}

	if (!directive.tokens.includes(token)) directive.tokens.push(token)
}

/**
 * Add hash sources to the CSP directives that control inline scripts and
 * styles. Existing directives are preserved; a policy that already allows
 * everything through `'unsafe-inline'` or `'none'` is left alone so adding a
 * hash cannot silently tighten it.
 */
export function addCspHashes(csp: string, hashes: CspHashes) {
	const directives = csp
		.split(';')
		.map(part => part.trim())
		.filter(Boolean)
		.map(parseDirective)

	add('script')
	add('style')

	return directives.map(formatDirective).join('; ')

	function add(kind: 'script' | 'style') {
		const values = hashes[kind]

		if (values.length === 0) return

		const names =
			kind === 'script'
				? ['script-src-elem', 'script-src', 'default-src']
				: ['style-src-elem', 'style-src', 'default-src']
		const directive = names
			.map(name => directives.find(candidate => candidate.name === name))
			.find(Boolean)

		if (!directive) return
		if (
			directive.tokens.some(
				token =>
					token.toLowerCase() === "'unsafe-inline'" || token.toLowerCase() === "'none'",
			)
		) {
			return
		}

		for (const value of values) {
			if (!directive.tokens.includes(value)) directive.tokens.push(value)
		}
	}
}

function parseDirective(value: string): Directive {
	const [name, ...tokens] = value.split(/\s+/)

	return { name: name.toLowerCase(), tokens }
}

function formatDirective(directive: Directive) {
	return [directive.name, ...directive.tokens].join(' ')
}
