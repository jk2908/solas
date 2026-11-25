import { describe, it, expect } from 'vitest'

import {
	writeBrowserConfig,
	writeConfig,
} from '../../../../src/internal/codegen/config.js'

describe('writeBrowserConfig', () => {
	it('only serialises client-safe fields', () => {
		const result = writeBrowserConfig({
			precompress: true,
			prerender: 'full',
			router: { cache: { maxBytes: 1024 } },
			headers: { 'x-test': 'yes' },
		})

		expect(result).toContain('maxBytes: 1024')
		expect(result).not.toContain('precompress')
		expect(result).not.toContain('prerender')
		expect(result).not.toContain('x-test')
	})

	it('includes the layout cache entry limit', () => {
		const result = writeBrowserConfig({ router: { cache: { maxLayoutEntries: 25 } } })

		expect(result).toContain('maxLayoutEntries: 25')
	})

	it('includes the router cache ttl', () => {
		const result = writeBrowserConfig({ router: { cache: { ttl: 500 } } })

		expect(result).toContain('ttl: 500')
	})

	it('includes the router cache mode', () => {
		const result = writeBrowserConfig({ router: { cache: { mode: 'prerendered' } } })

		expect(result).toContain("mode: 'prerendered'")
	})

	it('omits router config when cache settings are unset', () => {
		const result = writeBrowserConfig({})

		expect(result).not.toContain('router')
	})
})

describe('writeConfig', () => {
	it('generates config export', () => {
		const result = writeConfig({ trailingSlash: 'never' })
		expect(result).toContain('export { config }')
		expect(result).toContain('const config =')
	})

	it('includes provided config keys', () => {
		const result = writeConfig({ trailingSlash: 'always' })
		expect(result).toContain('trailingSlash')
	})

	it('includes logger import when logger level is set', () => {
		const result = writeConfig({ logger: { level: 'debug' } })
		expect(result).toContain("import { Logger } from '@jk2908/solas/utils/logger'")
		expect(result).toContain('Logger.defaultLevel')
	})

	it('omits logger import when no logger level', () => {
		const result = writeConfig({ trailingSlash: 'never' })
		expect(result).not.toContain('Logger')
	})

	it('adds satisfies RuntimeConfig', () => {
		const result = writeConfig({ trailingSlash: 'never' })
		expect(result).toContain('satisfies RuntimeConfig')
	})

	it('does not serialise the adapter', () => {
		const result = writeConfig({
			trailingSlash: 'never',
			adapter: { name: 'cloudflare', plugins: [{ name: 'some-plugin' }] },
		})

		expect(result).not.toContain('adapter')
		expect(result).not.toContain('some-plugin')
	})

	it('snapshot: minimal config', () => {
		expect(writeConfig({ trailingSlash: 'never' })).toMatchSnapshot()
	})

	it('snapshot: full config', () => {
		expect(
			writeConfig({
				url: 'https://example.com',
				trailingSlash: 'always',
				precompress: true,
				prerender: 'full',
				metadata: { title: 'My Site' },
				logger: { level: 'debug' },
				trustedOrigins: ['https://cdn.example.com'],
			}),
		).toMatchSnapshot()
	})

	it('snapshot: config with sitemap', () => {
		expect(
			writeConfig({
				url: 'https://example.com',
				sitemap: true,
			}),
		).toMatchSnapshot()
	})
})
