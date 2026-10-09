import type { PluginConfig } from './types.js'

export const NAME = 'Solas'
export const SLUG = NAME.toLowerCase()
export const PKG_NAME = `@jk2908/${SLUG}`
export const OUT_DIR = 'dist'
export const APP_DIR = 'app'
export const GENERATED_DIR = `.${SLUG}`
export const ENTRY_RSC = 'entry.rsc.tsx'
export const ENTRY_SSR = 'entry.ssr.tsx'
export const ENTRY_BROWSER = 'entry.browser.tsx'
export const ASSETS_DIR = `_${SLUG}`
export const PUBLIC_DIR = 'public'
export const $ = Symbol(SLUG)
export const REQUEST_META_KEY = `__${SLUG.toUpperCase()}__`
export const LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'fatal'] as const
export const PRERENDER_MODES = ['full', 'ppr', false] as const
export const TRAILING_SLASH_MODES = ['always', 'never', 'ignore'] as const
export const RUNTIME_MANIFEST = 'runtime-manifest.json'

const CONFIG_KEYS = new Set([
	'adapter',
	'logger',
	'metadata',
	'precompress',
	'prerender',
	'sitemap',
	'trustedOrigins',
	'trailingSlash',
	'url',
])
const LOGGER_KEYS = new Set(['level'])

/**
 * Validate the plugin configuration object, throwing an error if invalid.
 * @param input - The unvalidated configuration object.
 * @returns The typed and validated configuration object.
 */
export function validate(input: unknown) {
	if (input === undefined) return {} satisfies PluginConfig

	const errors: string[] = []

	if (!isRecord(input)) {
		throw new Error(`[${NAME}] Invalid config:\n- Expected plugin config to be an object`)
	}

	for (const key of Object.keys(input)) {
		if (!CONFIG_KEYS.has(key)) {
			errors.push(`Unknown config key: ${key}`)
		}
	}

	if ('url' in input && input.url !== undefined) {
		if (typeof input.url !== 'string') {
			errors.push('url must be a string')
		} else {
			try {
				const url = new URL(input.url)

				if (url.protocol !== 'http:' && url.protocol !== 'https:') {
					errors.push('url must use http:// or https://')
				}
			} catch {
				errors.push('url must be a valid URL')
			}
		}
	}

	if ('adapter' in input && input.adapter !== undefined) {
		const adapter = input.adapter

		if (
			!isRecord(adapter) ||
			typeof adapter.name !== 'string' ||
			!Array.isArray(adapter.plugins)
		) {
			errors.push('adapter must be an object with a string `name` and a `plugins` array')
		}
	}

	if ('precompress' in input && input.precompress !== undefined) {
		if (typeof input.precompress !== 'boolean') {
			errors.push('precompress must be a boolean')
		}
	}

	if ('trustedOrigins' in input && input.trustedOrigins !== undefined) {
		if (!Array.isArray(input.trustedOrigins)) {
			errors.push('trustedOrigins must be an array of origins')
		} else {
			for (const [index, value] of input.trustedOrigins.entries()) {
				if (typeof value !== 'string') {
					errors.push(`trustedOrigins[${index}] must be a string`)
					continue
				}

				try {
					const url = new URL(value)
					const canonical = value.replace(/\/$/, '')

					if (url.protocol !== 'http:' && url.protocol !== 'https:') {
						errors.push(`trustedOrigins[${index}] must use http:// or https://`)
						continue
					}

					if (canonical !== url.origin) {
						errors.push(
							`trustedOrigins[${index}] must be an origin without a path, query, or hash`,
						)
					}
				} catch {
					errors.push(`trustedOrigins[${index}] must be a valid URL origin`)
				}
			}
		}
	}

	if ('sitemap' in input && input.sitemap !== undefined && input.sitemap !== false) {
		if (typeof input.sitemap !== 'boolean' && typeof input.sitemap !== 'object') {
			errors.push('sitemap must be a boolean or an object with a routes function')
		}

		if (
			typeof input.sitemap === 'object' &&
			input.sitemap !== null &&
			typeof (input.sitemap as Record<string, unknown>).routes !== 'function'
		) {
			errors.push('sitemap.routes must be a function')
		}
	}

	if ('prerender' in input && input.prerender !== undefined) {
		if (
			!new Set(PRERENDER_MODES).has(input.prerender as (typeof PRERENDER_MODES)[number])
		) {
			errors.push("prerender must be 'full', 'ppr', or false")
		}
	}

	if ('trailingSlash' in input && input.trailingSlash !== undefined) {
		if (
			typeof input.trailingSlash !== 'string' ||
			!new Set(TRAILING_SLASH_MODES).has(
				input.trailingSlash as (typeof TRAILING_SLASH_MODES)[number],
			)
		) {
			errors.push("trailingSlash must be 'always', 'never', or 'ignore'")
		}
	}

	if ('metadata' in input && input.metadata !== undefined && !isRecord(input.metadata)) {
		errors.push('metadata must be an object when provided')
	}

	if ('logger' in input && input.logger !== undefined) {
		if (!isRecord(input.logger)) {
			errors.push('logger must be an object when provided')
		} else {
			for (const key of Object.keys(input.logger)) {
				if (!LOGGER_KEYS.has(key)) {
					errors.push(`Unknown logger key: ${key}`)
				}
			}

			if ('level' in input.logger && input.logger.level !== undefined) {
				if (
					typeof input.logger.level !== 'string' ||
					!new Set(LOG_LEVELS).has(input.logger.level as (typeof LOG_LEVELS)[number])
				) {
					errors.push('logger.level must be one of: debug, info, warn, error, fatal')
				}
			}
		}
	}

	if (errors.length > 0) {
		throw new Error(`[${NAME}] Invalid config:\n- ${errors.join('\n- ')}`)
	}

	return input as PluginConfig
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}
