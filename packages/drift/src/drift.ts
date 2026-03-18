import type { PluginConfig } from './types'

export namespace Drift {
	export namespace Config {
		export const NAME = 'drift'
		export const PKG_NAME = `@jk2908/${NAME}`
		export const APP_DIR = 'app'
		export const GENERATED_DIR = `.${NAME}`
		export const ENTRY_RSC = 'entry.rsc.tsx'
		export const ENTRY_SSR = 'entry.ssr.tsx'
		export const ENTRY_BROWSER = 'entry.browser.tsx'
		export const ASSETS_DIR = 'assets'
		export const $ = Symbol(NAME)
		export const REQUEST_META = '__DRIFT__'
		export const LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'fatal'] as const
		export const PRERENDER_MODES = ['full', 'ppr', false] as const

		const CONFIG_KEYS = new Set([
			'logger',
			'metadata',
			'outDir',
			'precompress',
			'prerender',
			'trailingSlash',
			'url',
		])
		const LOGGER_KEYS = new Set(['level'])

		/**
		 * Validate the plugin configuration object, throwing an error if invalid
		 * @param input - the unvalidated configuration object
		 * @return the typed and validated configuration object
		 */
		export function validate(input: unknown) {
			if (input === undefined) return {} satisfies PluginConfig

			const errors: string[] = []

			if (!isRecord(input)) {
				throw new Error(
					'[drift] Invalid config:\n- Expected plugin config to be an object',
				)
			}

			for (const key of Object.keys(input)) {
				if (!CONFIG_KEYS.has(key)) {
					errors.push(`Unknown config key: ${key}`)
				}
			}

			if ('url' in input && input.url !== undefined) {
				if (typeof input.url !== 'string') {
					errors.push('config.url must be a string')
				} else {
					try {
						const url = new URL(input.url)

						if (url.protocol !== 'http:' && url.protocol !== 'https:') {
							errors.push('config.url must use http:// or https://')
						}
					} catch {
						errors.push('config.url must be a valid URL')
					}
				}
			}

			if ('precompress' in input && input.precompress !== undefined) {
				if (typeof input.precompress !== 'boolean') {
					errors.push('config.precompress must be a boolean')
				}
			}

			if ('prerender' in input && input.prerender !== undefined) {
				if (
					!new Set(PRERENDER_MODES).has(
						input.prerender as (typeof PRERENDER_MODES)[number],
					)
				) {
					errors.push("config.prerender must be 'full', 'ppr', or false")
				}
			}

			if ('outDir' in input && input.outDir !== undefined) {
				if (typeof input.outDir !== 'string' || input.outDir.trim().length === 0) {
					errors.push('config.outDir must be a non-empty string')
				}
			}

			if ('trailingSlash' in input && input.trailingSlash !== undefined) {
				if (typeof input.trailingSlash !== 'boolean') {
					errors.push('config.trailingSlash must be a boolean')
				}
			}

			if (
				'metadata' in input &&
				input.metadata !== undefined &&
				!isRecord(input.metadata)
			) {
				errors.push('config.metadata must be an object when provided')
			}

			if ('logger' in input && input.logger !== undefined) {
				if (!isRecord(input.logger)) {
					errors.push('config.logger must be an object when provided')
				} else {
					for (const key of Object.keys(input.logger)) {
						if (!LOGGER_KEYS.has(key)) {
							errors.push(`Unknown config.logger key: ${key}`)
						}
					}

					if ('level' in input.logger && input.logger.level !== undefined) {
						if (
							typeof input.logger.level !== 'string' ||
							!new Set(LOG_LEVELS).has(input.logger.level as (typeof LOG_LEVELS)[number])
						) {
							errors.push(
								'config.logger.level must be one of: debug, info, warn, error, fatal',
							)
						}
					}
				}
			}

			if (errors.length > 0) {
				throw new Error(`[drift] Invalid config:\n- ${errors.join('\n- ')}`)
			}

			return input as PluginConfig
		}
	}

	export function getVersion() {
		const value = (import.meta.env as Record<string, unknown>).DRIFT_VERSION

		if (typeof value !== 'string' || value.length === 0) {
			throw new Error('Missing drift package version')
		}

		return value
	}

	export namespace Events {
		export const names = {
			NAVIGATION: 'driftnavigation',
			NAVIGATION_ERROR: 'driftnavigationerror',
		} as const
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}
