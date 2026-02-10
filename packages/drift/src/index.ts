import fs from 'node:fs/promises'
import path from 'node:path'

import type { PluginOption, UserConfig, ViteDevServer } from 'vite'

import react from '@vitejs/plugin-react'
import rsc from '@vitejs/plugin-rsc'

import type { BuildContext, PluginConfig } from './types'

import { writeConfig } from './internal/codegen/config'
import {
	writeBrowserEntry,
	writeRSCEntry,
	writeSSREntry,
} from './internal/codegen/environments'
import { writeManifest } from './internal/codegen/manifest'
import { writeMaps } from './internal/codegen/maps'
import { writeRouter } from './internal/codegen/router'

import { Config } from './config'

import { Build } from './internal/build'

import { Format } from './utils/format'
import { Logger } from './utils/logger'
import { Time } from './utils/time'

const DEFAULT_CONFIG = {
	precompress: true,
	prerender: 'declarative',
	outDir: 'dist',
	trailingSlash: false,
} as const satisfies Partial<PluginConfig>

function drift(c: PluginConfig): PluginOption[] {
	const config = { ...DEFAULT_CONFIG, ...c }

	// @todo: runtime validation
	// @ts-expect-error
	config.url =
		config.url ?? process.env.VITE_APP_URL?.toString() ?? process.env.APP_URL?.toString()

	const transpiler = new Bun.Transpiler({ loader: 'tsx' })
	const logger = new Logger()

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

		const processor = new Build.Finder(buildContext, config)
		const { manifest, prerenderableRoutes, imports, modules } = await processor.run()

		// set prerenderable routes in context for use in closeBundle
		buildContext.prerenderableRoutes = prerenderableRoutes

		await Promise.all([
			Bun.write(path.join(generatedDir, 'config.ts'), writeConfig(config)),
			Bun.write(path.join(generatedDir, 'manifest.ts'), writeManifest(manifest)),
			Bun.write(path.join(generatedDir, 'maps.ts'), writeMaps(imports, modules)),
			Bun.write(path.join(generatedDir, 'router.tsx'), writeRouter(manifest, imports, config)),
			Bun.write(path.join(generatedDir, Config.ENTRY_RSC), writeRSCEntry(prerenderableRoutes)),
			Bun.write(path.join(generatedDir, Config.ENTRY_SSR), writeSSREntry()),
			Bun.write(path.join(generatedDir, Config.ENTRY_BROWSER), writeBrowserEntry()),
		])

		// format generated files, avoid stopping build on errors
		await Format.run(Config.GENERATED_DIR).catch(() => {})
	}

	// debounced build to avoid multiple builds on file changes
	const rebuild = Time.debounce(build, 1000)

	const plugin = {
		name: 'drift',
		enforce: 'pre' as const,
		async config(viteConfig: UserConfig) {
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
		configureServer(server: ViteDevServer) {
			logger.info('[configureServer]', `Watching for changes in ./${Config.APP_DIR}...`)

			server.watcher
				.on('add', (p: string) => {
					if (p.includes(Config.APP_DIR)) rebuild()
				})
				.on('change', (p: string) => {
					if (p.includes(Config.APP_DIR)) rebuild()
				})
				.on('unlink', (p: string) => {
					if (p.includes(Config.APP_DIR)) rebuild()
				})
		},
		async closeBundle() {
			if (process.env.NODE_ENV === 'development') return

			// Write build manifest for CLI to pick up
			const generatedDir = path.join(process.cwd(), Config.GENERATED_DIR)
			await Bun.write(
				path.join(generatedDir, 'build.json'),
				JSON.stringify({
					prerenderableRoutes: Array.from(buildContext.prerenderableRoutes),
					outDir: config.outDir,
					precompress: config.precompress,
				}),
			)

			logger.info('[closeBundle]', 'vite build complete')
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
