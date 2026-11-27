import fs from 'node:fs/promises'
import path from 'node:path'

import type { Plugin, PluginOption } from 'vite'

import { nodeFileTrace } from '@vercel/nft'

import { exists } from '../utils/fs.js'

import type { Solas } from '../solas.js'
import type { Adapter } from '../types.js'
import * as Config from '../config.js'

const DEFAULT_OUTPUT = '.vercel/output'
const DEFAULT_RUNTIME = 'nodejs22.x'
const FUNCTION_NAME = 'index.func'
const ROOT_FILES = ['sitemap.xml', 'robots.txt'] as const

async function copyFile(source: string, target: string) {
	await fs.mkdir(path.dirname(target), { recursive: true })
	await fs.copyFile(source, target)
}

/**
 * Find the package-manager root that contains linked or hoisted dependencies.
 */
async function traceBase(cwd: string) {
	let base = cwd
	let dir = cwd

	while (true) {
		try {
			const packageJson: unknown = JSON.parse(
				await fs.readFile(path.join(dir, 'package.json'), 'utf8'),
			)

			if (
				typeof packageJson === 'object' &&
				packageJson !== null &&
				'workspaces' in packageJson
			) {
				base = dir
			}
		} catch {}

		if (await exists(path.join(dir, 'pnpm-workspace.yaml'))) base = dir

		const parent = path.dirname(dir)
		if (parent === dir) return base
		dir = parent
	}
}

/**
 * Generate the Vercel Function entry.
 *
 * Vercel runs Node functions from the function directory. Solas resolves its
 * `dist` assets relative to the process cwd, so move there before loading the
 * built RSC handler.
 */
function functionEntry() {
	return `import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createHttpRequestListener } from '@jk2908/solas/runtime/node'

process.chdir(path.dirname(fileURLToPath(import.meta.url)))

const { default: handler } = await import('./dist/rsc/index.js')

export default createHttpRequestListener(handler)
`
}

/**
 * Trace the generated function's runtime imports and copy its dependencies
 * into the function's private filesystem.
 *
 * The trace base is the workspace root when the app is in a monorepo, so
 * hoisted and linked dependencies resolve the same way they do at build time.
 */
async function traceFunction(cwd: string, functionDir: string) {
	const base = await traceBase(cwd)
	const result = await nodeFileTrace(
		[path.join(functionDir, 'index.mjs'), path.join(functionDir, 'dist/rsc/index.js')],
		{ base, processCwd: cwd },
	)

	for (const file of result.fileList) {
		if (!file.startsWith('node_modules/')) continue

		const source = path.join(base, file)
		const target = path.join(functionDir, file)
		const stat = await fs.stat(source)

		if (stat.isDirectory()) {
			await fs.cp(source, target, { recursive: true, dereference: true })
		} else {
			await copyFile(source, target)
		}
	}

	// keep the built RSC files in ESM mode without inheriting build scripts
	// or workspace dependency declarations
	await fs.writeFile(
		path.join(functionDir, 'package.json'),
		JSON.stringify({ type: 'module' }, null, 2),
	)
}

/**
 * Vercel adapter for Solas.
 *
 * Writes a Vercel Build Output containing:
 *
 * - static client assets in `.vercel/output/static`
 * - one Node function with the RSC handler and its `dist` assets
 * - routes that serve filesystem assets first, then the function
 *
 * Prerendered HTML and PPR artifacts stay inside the function so RSC requests
 * are never answered with static HTML by the asset layer.
 */
function adapter(options: Solas.VercelAdapterOptions = {}) {
	const cwd = process.cwd()
	const outputDir = path.resolve(cwd, options.outDir ?? DEFAULT_OUTPUT)
	const functionDir = path.join(outputDir, 'functions', FUNCTION_NAME)
	const staticDir = path.join(outputDir, 'static')
	const runtime = options.runtime ?? DEFAULT_RUNTIME

	const plugin: Plugin = {
		name: 'solas-vercel',
		enforce: 'post',
		buildApp: {
			order: 'post',
			async handler() {
				// this runs after Solas has written dist, the runtime manifest and
				// prerender artifacts
				const dist = path.join(cwd, Config.OUT_DIR)

				await fs.rm(outputDir, { recursive: true, force: true })
				await fs.mkdir(functionDir, { recursive: true })
				await fs.mkdir(staticDir, { recursive: true })

				// client files are public and can be served by the CDN
				await fs.cp(path.join(dist, 'client'), staticDir, { recursive: true })

				for (const file of ROOT_FILES) {
					const source = path.join(dist, file)

					if (await exists(source)) {
						await copyFile(source, path.join(staticDir, file))
					}
				}

				// the function owns prerenders, RSC payloads, PPR artifacts and the
				// runtime manifest so Accept-based routing stays on the server
				await fs.cp(dist, path.join(functionDir, 'dist'), { recursive: true })
				await fs.writeFile(path.join(functionDir, 'index.mjs'), functionEntry())

				const vcConfig = {
					runtime,
					handler: 'index.mjs',
					launcherType: 'Nodejs',
					supportsResponseStreaming: true,
					shouldAddSourcemapSupport: false,
					...(options.maxDuration === undefined
						? {}
						: { maxDuration: options.maxDuration }),
				}

				await fs.writeFile(
					path.join(functionDir, '.vc-config.json'),
					JSON.stringify(vcConfig, null, 2),
				)

				await traceFunction(cwd, functionDir)

				await fs.writeFile(
					path.join(outputDir, 'config.json'),
					JSON.stringify(
						{
							version: 3,
							routes: [
								// let Vercel serve client assets, sitemap and robots first
								{ handle: 'filesystem' },
								// then send documents, RSC requests and actions to Solas
								{ src: '/(.*)', dest: '/index' },
							],
						},
						null,
						2,
					),
				)
			},
		},
	}

	const plugins: PluginOption[] = [plugin]

	return { name: 'vercel', plugins } satisfies Adapter
}

export { adapter as default }
