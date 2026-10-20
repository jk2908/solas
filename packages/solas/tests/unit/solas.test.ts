import { afterEach, describe, expect, it, vi } from 'vitest'

import * as Config from '../../src/config.js'
import { names } from '../../src/events.js'
import { getManifestPath } from '../../src/manifest.js'
import { getVersion } from '../../src/solas.js'

describe('Solas', () => {
	describe('Config', () => {
		it('has expected constants', () => {
			expect(Config.NAME).toBe('Solas')
			expect(Config.SLUG).toBe('solas')
			expect(Config.PKG_NAME).toBe('@jk2908/solas')
			expect(Config.OUT_DIR).toBe('dist')
			expect(Config.APP_DIR).toBe('app')
			expect(Config.GENERATED_DIR).toBe('.solas')
			expect(Config.ENTRY_RSC).toBe('entry.rsc.tsx')
			expect(Config.ENTRY_SSR).toBe('entry.ssr.tsx')
			expect(Config.ENTRY_BROWSER).toBe('entry.browser.tsx')
			expect(Config.ASSETS_DIR).toBe('_solas')
			expect(Config.PUBLIC_DIR).toBe('public')
			expect(Config.RUNTIME_MANIFEST).toBe('runtime-manifest.json')
			expect(Config.REQUEST_META_KEY).toBe('__SOLAS__')
		})

		it('has expected log levels', () => {
			expect(Config.LOG_LEVELS).toEqual(['debug', 'info', 'warn', 'error', 'fatal'])
		})

		it('has expected prerender modes', () => {
			expect(Config.PRERENDER_MODES).toEqual(['full', 'ppr'])
			expect(Config.PRERENDER_OPTIONS).toEqual(['full', 'ppr', false])
		})

		it('has expected trailing slash modes', () => {
			expect(Config.TRAILING_SLASH_MODES).toEqual(['always', 'never', 'ignore'])
		})

		it('Config.$ is a symbol', () => {
			expect(typeof Config.$).toBe('symbol')
			expect(Config.$.toString()).toBe('Symbol(solas)')
		})

		describe('validate', () => {
			it('returns empty object for undefined input', () => {
				expect(Config.validate(undefined)).toEqual({})
			})

			it('throws for non-object input', () => {
				expect(() => Config.validate('string')).toThrow()
				expect(() => Config.validate(42)).toThrow()
			})

			it('throws for unknown keys', () => {
				expect(() => Config.validate({ unknownKey: true })).toThrow('Unknown config key')
			})

			it('rejects invalid URL', () => {
				expect(() => Config.validate({ url: 'not-a-url' })).toThrow(
					'url must be a valid URL',
				)
			})

			it('rejects URL with wrong protocol', () => {
				expect(() => Config.validate({ url: 'ftp://example.com' })).toThrow(
					'url must use http:// or https://',
				)
			})

			it('accepts valid http/https URLs', () => {
				expect(Config.validate({ url: 'https://example.com' })).toHaveProperty(
					'url',
					'https://example.com',
				)
			})

			it('rejects invalid prerender', () => {
				expect(() => Config.validate({ prerender: 'invalid' })).toThrow()
			})

			it('accepts valid prerender values', () => {
				expect(Config.validate({ prerender: 'full' })).toHaveProperty('prerender', 'full')
				expect(Config.validate({ prerender: 'ppr' })).toHaveProperty('prerender', 'ppr')
				expect(Config.validate({ prerender: false })).toHaveProperty('prerender', false)
			})

			it('rejects invalid precompress', () => {
				expect(() => Config.validate({ precompress: 'yes' })).toThrow()
			})

			it('accepts valid precompress', () => {
				expect(Config.validate({ precompress: true })).toHaveProperty('precompress', true)
			})

			it('rejects invalid nonce', () => {
				expect(() => Config.validate({ nonce: 'yes' })).toThrow()
			})

			it('accepts valid nonce values', () => {
				expect(Config.validate({ nonce: true })).toHaveProperty('nonce', true)
				expect(Config.validate({ nonce: false })).toHaveProperty('nonce', false)

				const generator = () => 'abc123'
				expect(Config.validate({ nonce: generator })).toHaveProperty('nonce', generator)
			})

			it('rejects invalid trailingSlash', () => {
				expect(() => Config.validate({ trailingSlash: 'sometimes' })).toThrow()
			})

			it('accepts valid trailingSlash', () => {
				expect(Config.validate({ trailingSlash: 'always' })).toHaveProperty(
					'trailingSlash',
					'always',
				)
			})

			it('accepts sitemap', () => {
				expect(Config.validate({ sitemap: true })).toHaveProperty('sitemap', true)
				expect(Config.validate({ sitemap: false })).toHaveProperty('sitemap', false)
			})

			it('rejects sitemap as object without routes function', () => {
				expect(() => Config.validate({ sitemap: {} })).toThrow(
					'sitemap.routes must be a function',
				)
			})

			it('accepts sitemap with routes function', () => {
				const config = Config.validate({
					sitemap: { routes: async (r: string[]) => r },
				})
				expect(config).toHaveProperty('sitemap')
			})

			it('validates trustedOrigins', () => {
				expect(() => Config.validate({ trustedOrigins: ['not-a-url'] })).toThrow()
			})

			it('validates trustedOrigins are origins without path', () => {
				expect(() =>
					Config.validate({ trustedOrigins: ['https://example.com/path'] }),
				).toThrow()
			})

			it('accepts valid trustedOrigins', () => {
				const config = Config.validate({
					trustedOrigins: ['https://example.com'],
				})
				expect(config).toHaveProperty('trustedOrigins', ['https://example.com'])
			})

			it('validates logger.level', () => {
				expect(() => Config.validate({ logger: { level: 'verbose' } })).toThrow()
			})

			it('accepts valid logger.level', () => {
				const config = Config.validate({ logger: { level: 'debug' } })
				expect(config).toHaveProperty('logger', { level: 'debug' })
			})
		})
	})

	describe('getVersion', () => {
		afterEach(() => {
			vi.unstubAllEnvs()
		})

		it('returns the version from env', () => {
			vi.stubEnv('SOLAS_VERSION', '1.0.0')
			expect(getVersion()).toBe('1.0.0')
		})

		it('throws when version is missing', () => {
			vi.stubEnv('SOLAS_VERSION', '')
			expect(() => getVersion()).toThrow()
		})
	})

	describe('Manifest', () => {
		describe('getManifestPath', () => {
			it('joins outDir segments correctly', () => {
				const result = getManifestPath('/app/dist')
				expect(result).toContain('solas')
				expect(result).toContain('runtime-manifest.json')
			})

			it('resolves relative to outDir', () => {
				const result = getManifestPath('dist')
				expect(result).toContain('dist')
				expect(result).toContain('.solas')
				expect(result).toContain('runtime-manifest.json')
			})
		})
	})

	describe('Events', () => {
		it('has expected event names', () => {
			expect(names.NAVIGATION).toBe('solasnavigation')
			expect(names.NAVIGATION_ERROR).toBe('solasnavigationerror')
		})
	})
})
