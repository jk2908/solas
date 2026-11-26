import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { RoutePaths } from '../../../src/types.js'
import {
	collectRouteClientReferences,
	loadClientAssetManifest,
	loadClientAssetsByRoute,
} from '../../../src/internal/client-css.js'

let root: string

beforeEach(async () => {
	root = await fs.mkdtemp(path.join(os.tmpdir(), 'solas-client-css-'))
})

afterEach(async () => {
	await fs.rm(root, { recursive: true, force: true })
})

describe('loadClientAssetManifest', () => {
	it('collects entry and client-reference assets', async () => {
		await fs.mkdir(path.join(root, 'rsc'), { recursive: true })
		await fs.writeFile(
			path.join(root, 'rsc', '__vite_rsc_assets_manifest.js'),
			`export default ${JSON.stringify({
				clientEntryDeps: {
					js: ['/entry.js'],
					css: ['/entry.css'],
				},
				clientReferenceDeps: {
					a: { js: ['/a.js', '/entry.js'], css: ['/a.css', '/entry.css'] },
					b: { js: ['/b.js'], css: ['/b.css'] },
				},
			})}`,
		)

		expect(await loadClientAssetManifest(root)).toEqual({
			entry: { js: ['/entry.js'], css: ['/entry.css'] },
			byReference: {
				a: { js: ['/a.js', '/entry.js'], css: ['/a.css', '/entry.css'] },
				b: { js: ['/b.js'], css: ['/b.css'] },
			},
		})
	})
})

describe('loadClientAssetsByRoute', () => {
	it('maps route references to deduplicated JS and CSS', () => {
		const plan = loadClientAssetsByRoute(
			{
				'/': ['layout', 'page'],
				'/other': ['layout'],
			},
			{
				entry: { js: ['/entry.js'], css: ['/entry.css'] },
				byReference: {
					layout: { js: ['/layout.js'], css: ['/layout.css'] },
					page: { js: ['/page.js'], css: ['/page.css'] },
				},
			},
		)

		expect(plan).toEqual({
			'/': {
				js: ['/entry.js', '/layout.js', '/page.js'],
				css: ['/entry.css', '/layout.css', '/page.css'],
			},
			'/other': {
				js: ['/entry.js', '/layout.js'],
				css: ['/entry.css', '/layout.css'],
			},
		})
	})
})

describe('collectRouteClientReferences', () => {
	it('follows the RSC chunk graph for each route', () => {
		const generated = path.join(root, '.solas')
		const base: Omit<RoutePaths, 'page'> = {
			layouts: ['../app/+layout'],
			'401s': [],
			'403s': [],
			'404s': [],
			'500s': [],
			loaders: [],
			middlewares: [],
		}
		const bundle = {
			'index.js': {
				type: 'chunk',
				fileName: 'index.js',
				moduleIds: [
					path.join(root, 'app/+layout.tsx'),
					path.join(root, 'app/layout-client.tsx'),
				],
				imports: [],
			},
			'page.js': {
				type: 'chunk',
				fileName: 'page.js',
				moduleIds: [
					path.join(root, 'app/+page.tsx'),
					path.join(root, 'app/page-client.tsx'),
				],
				imports: ['index.js'],
			},
			'other.js': {
				type: 'chunk',
				fileName: 'other.js',
				moduleIds: [
					path.join(root, 'app/other.tsx'),
					path.join(root, 'app/other-client.tsx'),
				],
				imports: ['index.js'],
			},
		}
		const metaMap = {
			[path.join(root, 'app/layout-client.tsx')]: { referenceKey: 'layout' },
			[path.join(root, 'app/page-client.tsx')]: { referenceKey: 'page' },
			[path.join(root, 'app/other-client.tsx')]: { referenceKey: 'other' },
		}

		const references = collectRouteClientReferences(
			{
				'/': { ...base, page: '../app/+page' },
				'/other': { ...base, page: '../app/other' },
			},
			bundle,
			metaMap,
			generated,
		)

		expect(references).toEqual({
			'/': ['layout', 'page'],
			'/other': ['layout', 'other'],
		})
	})
})
