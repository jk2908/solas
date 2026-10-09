import { describe, it, expect } from 'vitest'

import { writeConfig } from '../../../../src/internal/codegen/config.js'

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
