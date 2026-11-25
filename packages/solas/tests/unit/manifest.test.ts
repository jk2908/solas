import { describe, expect, it } from 'vitest'

import type { Assets } from '../../src/internal/assets.js'
import { loadManifest } from '../../src/manifest.js'

function assetsWith(value: unknown): Assets {
	return {
		exists: async () => true,
		readText: async () => JSON.stringify(value),
		readBuffer: async () => new ArrayBuffer(0),
		mimeType: () => 'application/json',
	}
}

describe('loadManifest', () => {
	it('loads prerender CSP hashes', async () => {
		const manifest = await loadManifest(
			assetsWith({
				artifacts: {
					'/': {
						mode: 'full',
						files: ['html'],
						csp: { script: ["'sha256-script'"], style: ["'sha256-style'"] },
					},
				},
				publicFiles: [],
			}),
		)

		expect(manifest?.artifacts['/'].csp).toEqual({
			script: ["'sha256-script'"],
			style: ["'sha256-style'"],
		})
	})

	it('accepts manifests from before CSP hashes were added', async () => {
		const manifest = await loadManifest(
			assetsWith({ artifacts: { '/': { mode: 'full', files: ['html'] } } }),
		)

		expect(manifest?.artifacts['/'].mode).toBe('full')
	})

	it('loads the PPR page cache policy', async () => {
		const manifest = await loadManifest(
			assetsWith({
				artifacts: {
					'/static-page': {
						mode: 'ppr',
						files: ['metadata', 'prelude', 'shell'],
						dynamicPage: false,
					},
					'/dynamic-page': {
						mode: 'ppr',
						files: ['metadata', 'prelude', 'shell'],
						dynamicPage: true,
					},
				},
			}),
		)

		expect(manifest?.artifacts['/static-page'].dynamicPage).toBe(false)
		expect(manifest?.artifacts['/dynamic-page'].dynamicPage).toBe(true)
	})

	it('loads per-route client CSS', async () => {
		const manifest = await loadManifest(
			assetsWith({
				artifacts: {},
				publicFiles: [],
				clientCssByRoute: {
					'/': ['/_solas/page.css'],
					'/writing/:slug': [],
				},
			}),
		)

		expect(manifest?.clientCssByRoute).toEqual({
			'/': ['/_solas/page.css'],
			'/writing/:slug': [],
		})
	})

	it('loads the CSP config and trailing slash mode', async () => {
		const manifest = await loadManifest(
			assetsWith({
				artifacts: {},
				publicFiles: [],
				csp: {
					directives: {
						'default-src': ['self'],
					},
				},
				trailingSlash: 'always',
			}),
		)

		expect(manifest?.csp?.directives).toEqual({ 'default-src': ['self'] })
		expect(manifest?.trailingSlash).toBe('always')
	})

	it('rejects malformed CSP hashes', async () => {
		const manifest = await loadManifest(
			assetsWith({
				artifacts: {
					'/': {
						mode: 'full',
						csp: { script: ["'sha256-script'"], style: [1] },
					},
				},
			}),
		)

		expect(manifest).toBeNull()
	})
})
