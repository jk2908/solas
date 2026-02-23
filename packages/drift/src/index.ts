import fs from 'node:fs/promises'
import path from 'node:path'

import type { PluginOption } from 'vite'

import react from '@vitejs/plugin-react'
import rsc from '@vitejs/plugin-rsc'

import type { BuildContext, PluginConfig } from './types'

import { writeConfig } from './codegen/config'
import { writeBrowserEntry, writeRSCEntry, writeSSREntry } from './codegen/environments'
import { writeManifest } from './codegen/manifest'
import { writeMaps } from './codegen/maps'
import { writeRouter } from './codegen/router'

import { Config } from './config'

import { Logger } from './shared/logger'

import { Compress } from './server/compress'
import { prerender } from './server/prerender'
import { format } from './server/utils'

import { Build } from './build'

import { debounce } from './utils'

const DEFAULT_CONFIG = {
	precompress: true,
	prerender: 'declarative',
	outDir: 'dist',
	trailingSlash: false,
} as const satisfies Partial<PluginConfig>

function drift(c: PluginConfig): PluginOption[] {
	const config = { ...DEFAULT_CONFIG, ...c }

	config.app = {
		...(config.app ?? {}),
		// @todo: runtime validation
		// @ts-expect-error
		url:
			config.app?.url ??
			process.env.VITE_APP_URL?.toString() ??
			process.env.APP_URL?.toString(),
	}

	config.logger = {
		...(config.logger ?? {}),
		level:
			(config.logger?.level ??
			(import.meta.env.PROD || process.env.NODE_ENV === 'production'))
				? 'error'
				: 'debug',
	}

	const transpiler = new Bun.Transpiler({ loader: 'tsx' })
	const logger = new Logger(config.logger.level)

	const buildContext: BuildContext = {
		outDir: config.outDir,
		bundle: {
			server: {
				entryPath: null,
				outDir: null,
			},
			client: {
				entryPath: null,
				outDir: null,
			},
		},
		transpiler,
		logger,
		prerenderableRoutes: new Set<string>(),
	}

	async function build() {
		const cwd = process.cwd()
		const routesDir = path.join(cwd, Config.APP_DIR)
		const generatedDir = path.join(cwd, Config.GENERATED_DIR)

		await Promise.all([
			fs.mkdir(routesDir, { recursive: true }),
			fs.mkdir(generatedDir, { recursive: true }),
		])

		const processor = new Build.RouteProcessor(buildContext, config)
		const { manifest, prerenderableRoutes, imports, modules } = await processor.run()

		// set prerenderable routes in context for use in closeBundle
		buildContext.prerenderableRoutes = prerenderableRoutes

		await Promise.all([
			Bun.write(path.join(generatedDir, 'config.ts'), writeConfig(config)),
			Bun.write(path.join(generatedDir, 'manifest.ts'), writeManifest(manifest)),
			Bun.write(path.join(generatedDir, 'maps.ts'), writeMaps(imports, modules)),
			Bun.write(path.join(generatedDir, 'router.tsx'), writeRouter(manifest, imports)),
			Bun.write(path.join(generatedDir, Config.ENTRY_RSC), writeRSCEntry()),
			Bun.write(path.join(generatedDir, Config.ENTRY_SSR), writeSSREntry()),
			Bun.write(path.join(generatedDir, Config.ENTRY_BROWSER), writeBrowserEntry()),
		])

		// format generated files, avoid stopping build on errors
		await format(Config.GENERATED_DIR, buildContext).catch(() => {})
	}

	// debounced build to avoid multiple builds on file changes
	const rebuild = debounce(build, 1000)

	const plugin: PluginOption = {
		name: 'drift',
		enforce: 'pre',
		async config(viteConfig) {
			await build()

			viteConfig.build ??= {}
			viteConfig.build.outDir = config.outDir

			viteConfig.server ??= {}
			viteConfig.server.port = 8787

			viteConfig.define ??= {}
			viteConfig.define['import.meta.env.APP_URL'] = JSON.stringify(process.env.APP_URL)
			viteConfig.define['import.meta.env.VITE_APP_URL'] = JSON.stringify(
				process.env.VITE_APP_URL,
			)

			viteConfig.resolve ??= {}
			viteConfig.resolve.alias = {
				...(viteConfig.resolve.alias ?? {}),
				'.drift': path.resolve(process.cwd(), Config.GENERATED_DIR),
			}

			viteConfig.optimizeDeps ??= {}
			viteConfig.optimizeDeps.exclude = [
				...(Array.isArray(viteConfig.optimizeDeps.exclude)
					? viteConfig.optimizeDeps.exclude
					: []),
				'react-dom/client',
			]
		},
		configureServer(server) {
			logger.info('[configureServer]', `Watching for changes in ./${Config.APP_DIR}...`)

			server.watcher
				.on('add', path => {
					if (path.includes(Config.APP_DIR)) rebuild()
				})
				.on('change', path => {
					if (path.includes(Config.APP_DIR)) rebuild()
				})
				.on('unlink', path => {
					if (path.includes(Config.APP_DIR)) rebuild()
				})
		},
		async closeBundle() {
			if (process.env.NODE_ENV === 'development') return

			try {
				if (buildContext.prerenderableRoutes.size > 0) {
					if (!config.app?.url) {
						logger.error(
							'[closeBundle]',
							'Skipping prerender: no app URL configured. Set the VITE_APP_URL env var or set the app.url in the plugin config',
						)
					} else {
						Bun.env.PRERENDER = 'true'

						try {
							if (
								!buildContext.bundle.server.outDir ||
								!buildContext.bundle.server.entryPath
							) {
								throw new Error('No server outDir or entryPath found')
							}

							const app = (
								await import(
									`file://${Bun.file(buildContext.bundle.server.entryPath).name}`
								)
							).default

							for (const route of buildContext.prerenderableRoutes) {
								const { value, done } = await prerender(
									(req: Request) => app.fetch(req),
									route,
									config.app.url,
									buildContext,
								).next()

								if (done || !value) {
									logger.warn('[closeBundle]', `skipped prerendering ${route}: no output`)
									continue
								}

								const { status, body } = value

								if (status !== 200) {
									logger.warn('[closeBundle]', `skipped prerendering ${route}: ${status}`)
									continue
								}

								const outPath =
									route === '/'
										? path.join(buildContext.bundle.server.outDir, 'index.html')
										: path.join(buildContext.bundle.server.outDir, route, 'index.html')

								await fs.mkdir(path.dirname(outPath), { recursive: true })
								await Bun.write(outPath, body)

								logger.info('[closeBundle]', `prerendered ${route} to ${outPath}`)
							}
						} catch (err) {
							logger.error('[closeBundle:prerender]', err)
						} finally {
							logger.info('[closeBundle]', 'stopping server')
							Bun.env.PRERENDER = 'false'
						}
					}
				}

				if (config.precompress) {
					try {
						const dir = path.resolve(process.cwd(), config.outDir)

						for await (const { input, compressed } of Compress.run(dir, buildContext, {
							filter: f => /\.(js|css|html|svg|json|txt)$/.test(f),
						})) {
							await Bun.write(`${input}.br`, compressed)
							logger.info(
								'[closeBundle:precompress]',
								`compressed ${input} to ${input}.br`,
							)
						}
					} catch (err) {
						logger.error('[closeBundle:precompress]', err)
					}
				}
			} catch (err) {
				logger.error('[closeBundle]', err)
				return
			} finally {
				buildContext.bundle.server = {
					entryPath: null,
					outDir: null,
				}

				// fini
				logger.info('[closeBundle]', 'build complete')
			}
		},
	}

	return [
		plugin,
		rsc({
			entries: {
				rsc: `./${Config.GENERATED_DIR}/${Config.ENTRY_RSC}`,
				ssr: `./${Config.GENERATED_DIR}/${Config.ENTRY_SSR}`,
				client: `./${Config.GENERATED_DIR}/${Config.ENTRY_BROWSER}`,
			},
		}),
		react(),
	]
}

export default drift

export * from './types'

export type * from './drift.d.ts'
