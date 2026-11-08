import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { RoutePaths } from '../../../src/types.js'
import {
	collectRouteClientReferences,
	loadClientCssManifest,
} from '../../../src/internal/client-css.js'

let root: string

beforeEach(async () => {
	root = await fs.mkdtemp(path.join(os.tmpdir(), 'solas-client-css-'))
})

afterEach(async () => {
	await fs.rm(root, { recursive: true, force: true })
})

describe('loadClientCssManifest', () => {
	it('collects entry and client-reference stylesheets', async () => {
		await fs.mkdir(path.join(root, 'rsc'), { recursive: true })
		await fs.writeFile(
			path.join(root, 'rsc', '__vite_rsc_assets_manifest.js'),
			`export default ${JSON.stringify({
				clientEntryDeps: { js: [], css: ['/entry.css'] },
				clientReferenceDeps: {
					a: { js: [], css: ['/a.css', '/entry.css'] },
					b: { js: [], css: ['/b.css'] },
				},
			})}`,
		)

		expect(await loadClientCssManifest(root)).toEqual({
			entry: ['/entry.css'],
			byReference: {
				a: ['/a.css', '/entry.css'],
				b: ['/b.css'],
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
