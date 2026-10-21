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
