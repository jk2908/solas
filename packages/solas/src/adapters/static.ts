import fs from 'node:fs/promises'
import path from 'node:path'

import type { Plugin, PluginOption } from 'vite'

import type { Adapter } from '../types.js'
import * as Config from '../config.js'
import { Features, guards } from '../internal/guards.js'
import { staticRoutePath } from '../internal/prerender.js'
import { buildCsp } from '../internal/server/csp.js'
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

						const policy = buildCsp(csp.directives, undefined, {
							script: artifact.csp?.script ?? [],
							style: [...new Set([...(artifact.csp?.style ?? []), ...styleHashes])],
						})

						if (!policy) return

						await fs.writeFile(file, injectCspMeta(html, policy))
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

function injectCspMeta(html: string, csp: string) {
	if (/<meta\b[^>]*http-equiv=["']?content-security-policy/i.test(html)) {
		return html
	}

	const head = /<head\b[^>]*>/i.exec(html)

	if (!head) return html

	const headEnd = head.index + head[0].length
	const charset = /<meta\b[^>]*charset=[^>]*>/i.exec(html.slice(headEnd))
	const tag = `<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(csp)}">`
	const at = charset ? headEnd + charset.index + charset[0].length : headEnd

	return html.slice(0, at) + tag + html.slice(at)
}

function escapeAttribute(value: string) {
	return value
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
}

export { adapter as default }
