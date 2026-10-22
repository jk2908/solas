import type { CspDirectives } from '../types.js'

type Directive = {
	name: string
	tokens: string[]
}

type PolicyInput = {
	nonce?: string
	hashes?: CspHashes
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

export type CspHashes = {
	script: string[]
	style: string[]
}

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
	if (requestCsp) return extractNonce(requestCsp)

	return extractNonce(new Headers(configuredHeaders).get('content-security-policy'))
}

/**
 * Build a policy from structured directives, adding a nonce and any prerender
 * hashes that apply to the response.
 */
export function buildPolicy(
	directives: CspDirectives,
	{ nonce, hashes }: PolicyInput = {},
) {
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

	const policy = parsed.map(formatDirective).join('; ')

	return hashes ? addHashes(policy, hashes) : policy
}

/**
 * Add hash sources to the directives that control inline scripts and styles.
 * A policy that already allows everything through `'unsafe-inline'` or
 * `'none'` is left alone, so adding a hash cannot silently tighten it.
 */
export function addHashes(policy: string, hashes: CspHashes) {
	const directives = policy
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

/**
 * Add the request nonce to the PPR bootstrap script.
 */
export function addBootstrapNonce(html: string, nonce: string) {
	const match = /<script\b[^>]*\bid="_R_"[^>]*>/i.exec(html)

	if (!match || /\bnonce\s*=/i.test(match[0])) return html

	const tag = match[0].replace(/>$/, ` nonce="${escapeAttribute(nonce)}">`)

	return html.slice(0, match.index) + tag + html.slice(match.index + match[0].length)
}

/**
 * Add a CSP meta tag to a static document.
 */
export function injectMeta(html: string, policy: string) {
	if (/<meta\b[^>]*http-equiv=["']?content-security-policy/i.test(html)) {
		return html
	}

	const head = /<head\b[^>]*>/i.exec(html)

	if (!head) return html

	const headEnd = head.index + head[0].length
	const charset = /<meta\b[^>]*charset=[^>]*>/i.exec(html.slice(headEnd))
	const tag = `<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(policy)}">`
	const at = charset ? headEnd + charset.index + charset[0].length : headEnd

	return html.slice(0, at) + tag + html.slice(at)
}

function extractNonce(csp: string | null | undefined) {
	return csp?.match(/'nonce-([^']+)'/)?.[1] || undefined
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

function parseDirective(value: string): Directive {
	const [name, ...tokens] = value.split(/\s+/)

	return { name: name.toLowerCase(), tokens }
}

function formatDirective(directive: Directive) {
	return [directive.name, ...directive.tokens].join(' ')
}

function escapeAttribute(value: string) {
	return value
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
}
