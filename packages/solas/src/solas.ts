import type { Prerender } from './internal/prerender.js'
import type { PluginConfig } from './types.js'

export namespace Solas {
	export interface Routes {}

	export namespace Config {
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
			'port',
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
		 * Validate the plugin configuration object, throwing an error if invalid
		 * @param input - the unvalidated configuration object
		 * @return the typed and validated configuration object
		 */
		export function validate(input: unknown) {
			if (input === undefined) return {} satisfies PluginConfig

			const errors: string[] = []

			if (!isRecord(input)) {
				throw new Error(
					`[${Config.NAME}] Invalid config:\n- Expected plugin config to be an object`,
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

			if ('trustedOrigins' in input && input.trustedOrigins !== undefined) {
				if (!Array.isArray(input.trustedOrigins)) {
					errors.push('config.trustedOrigins must be an array of origins')
				} else {
					for (const [index, value] of input.trustedOrigins.entries()) {
						if (typeof value !== 'string') {
							errors.push(`config.trustedOrigins[${index}] must be a string`)
							continue
						}

						try {
							const url = new URL(value)
							const canonical = value.replace(/\/$/, '')

							if (url.protocol !== 'http:' && url.protocol !== 'https:') {
								errors.push(
									`config.trustedOrigins[${index}] must use http:// or https://`,
								)
								continue
							}

							if (canonical !== url.origin) {
								errors.push(
									`config.trustedOrigins[${index}] must be an origin without a path, query, or hash`,
								)
							}
						} catch {
							errors.push(`config.trustedOrigins[${index}] must be a valid URL origin`)
						}
					}
				}
			}

			if ('sitemap' in input && input.sitemap !== undefined && input.sitemap !== false) {
				if (typeof input.sitemap !== 'boolean' && typeof input.sitemap !== 'object') {
					errors.push(
						'config.sitemap must be a boolean or an object with a routes function',
					)
				}

				if (
					typeof input.sitemap === 'object' &&
					input.sitemap !== null &&
					typeof (input.sitemap as Record<string, unknown>).routes !== 'function'
				) {
					errors.push('config.sitemap.routes must be a function')
				}

				if (!input.url) {
					errors.push('config.url is required when sitemap is enabled')
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

			if ('trailingSlash' in input && input.trailingSlash !== undefined) {
				if (
					typeof input.trailingSlash !== 'string' ||
					!new Set(TRAILING_SLASH_MODES).has(
						input.trailingSlash as (typeof TRAILING_SLASH_MODES)[number],
					)
				) {
					errors.push("config.trailingSlash must be 'always', 'never', or 'ignore'")
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
				throw new Error(`[${Config.NAME}] Invalid config:\n- ${errors.join('\n- ')}`)
			}

			return input as PluginConfig
		}
	}

	export function getVersion() {
		const value = (import.meta.env as Record<string, unknown>).SOLAS_VERSION

		if (typeof value !== 'string' || value.length === 0) {
			throw new Error(`[${Config.NAME}] Missing ${Config.NAME} package version`)
		}

		return value
	}

	export namespace Runtime {
		export type Manifest = {
			artifacts: Prerender.Artifact.Manifest
			publicFiles: ReadonlySet<string>
		}

		const manifestCache = new Map<string, Manifest | null>()

		export function getManifestPath(outDir: string) {
			return [outDir, Config.GENERATED_DIR, Config.RUNTIME_MANIFEST]
				.map((part, index) => {
					const normalised = part.replace(/\\/g, '/').replace(/\/+/g, '/')

					if (index === 0) return normalised.replace(/\/+$/, '')
					return normalised.replace(/^\/+/, '').replace(/\/+$/, '')
				})
				.join('/')
		}

		export async function loadManifest(outDir: string) {
			if (manifestCache.has(outDir)) {
				return manifestCache.get(outDir) ?? null
			}

			const file = Bun.file(getManifestPath(outDir))

			if (!(await file.exists())) {
				manifestCache.set(outDir, null)
				return null
			}

			try {
				const value = JSON.parse(await file.text())

				if (!isRecord(value)) {
					manifestCache.set(outDir, null)
					return null
				}

				const artifacts = value.artifacts ?? value.routes
				const publicFiles = value.publicFiles

				if (!isRecord(artifacts)) {
					manifestCache.set(outDir, null)
					return null
				}

				if (publicFiles !== undefined && !Array.isArray(publicFiles)) {
					manifestCache.set(outDir, null)
					return null
				}

				for (const entry of Object.values(artifacts)) {
					if (!isRecord(entry)) {
						manifestCache.set(outDir, null)
						return null
					}

					const { mode, files } = entry

					if (mode !== 'full' && mode !== 'ppr') {
						manifestCache.set(outDir, null)
						return null
					}

					if (files !== undefined) {
						if (!Array.isArray(files)) {
							manifestCache.set(outDir, null)
							return null
						}

						for (const file of files) {
							if (
								file !== 'html' &&
								file !== 'prelude' &&
								file !== 'postponed' &&
								file !== 'metadata'
							) {
								manifestCache.set(outDir, null)
								return null
							}
						}
					}
				}

				for (const entry of publicFiles ?? []) {
					if (typeof entry !== 'string' || !entry.startsWith('/')) {
						manifestCache.set(outDir, null)
						return null
					}
				}

				const manifest: Manifest = {
					artifacts: artifacts as Manifest['artifacts'],
					publicFiles: new Set((publicFiles as string[] | undefined) ?? []),
				}

				manifestCache.set(outDir, manifest)
				return manifest
			} catch {
				manifestCache.set(outDir, null)
				return null
			}
		}
	}

	export namespace Events {
		export const names = {
			NAVIGATION: `${Config.SLUG}navigation`,
			NAVIGATION_ERROR: `${Config.SLUG}navigationerror`,
		} as const
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}
