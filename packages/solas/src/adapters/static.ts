import fs from 'node:fs/promises'
import path from 'node:path'

import type { Plugin, PluginOption } from 'vite'

import type { Adapter } from '../types.js'
import * as Config from '../config.js'
import { buildPolicy, injectMeta } from '../internal/csp.js'
import { Features, guards } from '../internal/guards.js'
import { staticRoutePath } from '../internal/prerender.js'
import { loadManifest } from '../manifest.js'

export type SolasStaticOptions = {
	/**
	 * Directory, relative to the project root, the static site is written to.
	 *
	 * @default 'build'
	 */
	outDir?: string
}

const ROOT_FILES = ['sitemap.xml', 'robots.txt'] as const

/**
 * Static site adapter for Solas.
 *
 * Sets `prerender: 'full'` so every route is rendered to HTML at build time,
 * then merges Solas's output into a single directory any static host can serve:
 * the client assets, the full prerenders (at their route paths) and the
 * generated `sitemap.xml` / `robots.txt`.
 *
 * It installs the guards with no server features supported, so the build warns
 * when the graph contains server actions or `+endpoint` routes, which a static
 * host cannot run.
 */
function adapter(options: SolasStaticOptions = {}) {
	const cwd = process.cwd()
	const outDir = options.outDir ?? 'build'

	const plugin: Plugin = {
		name: 'solas-static',
		enforce: 'post',
		buildApp: {
			order: 'post',
			async handler() {
				// runs after Solas's own `post` buildApp, so `dist/client`,
				// `dist/static`, the sitemap and robots.txt already exist
				const dist = path.join(cwd, Config.OUT_DIR)
				const target = path.resolve(cwd, outDir)

				await fs.rm(target, { recursive: true, force: true })

				for (const dir of ['client', 'static'] as const) {
					const source = path.join(dist, dir)

					if (await exists(source)) {
						await fs.cp(source, target, { recursive: true })
					}
				}

				for (const file of ROOT_FILES) {
					const source = path.join(dist, file)

					if (await exists(source)) {
						await fs.copyFile(source, path.join(target, file))
					}
				}

				const manifest = await loadManifest()
				const csp = manifest?.csp

				if (!csp) return

				const mode = manifest.trailingSlash === 'always' ? 'always' : 'never'
				const styleHashes = [
					...new Set(
						Object.values(manifest.artifacts).flatMap(
							artifact => artifact.csp?.style ?? [],
						),
					),
				]

				await Promise.all(
					Object.entries(manifest.artifacts).map(async ([route, artifact]) => {
						if (artifact.mode !== 'full') return

						const file = path.join(target, staticRoutePath(route, mode))

						let html: string

						try {
							html = await fs.readFile(file, 'utf-8')
						} catch {
							return
						}

						const policy = buildPolicy(csp.directives, {
							hashes: {
								script: artifact.csp?.script ?? [],
								style: [...new Set([...(artifact.csp?.style ?? []), ...styleHashes])],
							},
						})

						if (!policy) return

						await fs.writeFile(file, injectMeta(html, policy))
					}),
				)
			},
		},
	}

	const plugins: PluginOption[] = [guards(Features.None), plugin]

	return { name: 'static', plugins, prerender: 'full' } satisfies Adapter
}

async function exists(filePath: string) {
	try {
		await fs.access(filePath)
		return true
	} catch {
		return false
	}
}

export { adapter as default }
