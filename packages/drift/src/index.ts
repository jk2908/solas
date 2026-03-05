import fsSync from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

import type { PluginOption, UserConfig, ViteDevServer } from 'vite'

import react from '@vitejs/plugin-react'
import rsc from '@vitejs/plugin-rsc'

import type { BuildContext, PluginConfig } from './types'

import { Drift } from './drift'

import { Format } from './utils/format'
import { Logger } from './utils/logger'
import { Time } from './utils/time'

import { Build } from './internal/build'
import { writeConfig } from './internal/codegen/config'
import {
	writeBrowserEntry,
	writeRSCEntry,
	writeSSREntry,
} from './internal/codegen/environments'
import { writeManifest } from './internal/codegen/manifest'
import { writeMaps } from './internal/codegen/maps'
import { writeRouter } from './internal/codegen/router'

const DEFAULT_CONFIG = {
	precompress: true,
	prerender: false,
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
		prerenderedRoutes: new Set<string>(),
	}

	function maybeWrite(filePath: string, content: string) {
		return fs
			.readFile(filePath, 'utf-8')
			.catch(() => null)
			.then(current => {
				if (current === content) return false

				return Bun.write(filePath, content).then(() => true)
			})
	}

	async function build() {
		const cwd = process.cwd()
		const routesDir = path.join(cwd, Drift.Config.APP_DIR)
		const generatedDir = path.join(cwd, Drift.Config.GENERATED_DIR)

		await Promise.all([
			fs.mkdir(routesDir, { recursive: true }),
			fs.mkdir(generatedDir, { recursive: true }),
		])

		const processor = new Build.Finder(buildContext, config)
		const { manifest, prerenderedRoutes, imports, modules } = await processor.run()

		// set prerenderable routes in context for use in closeBundle
		buildContext.prerenderedRoutes = prerenderedRoutes

		const files: [string, string][] = [
			['config.ts', writeConfig(config)],
			['manifest.ts', writeManifest(manifest)],
			['maps.ts', writeMaps(imports, modules)],
			['router.tsx', writeRouter(manifest, imports)],
			[Drift.Config.ENTRY_RSC, writeRSCEntry()],
			[Drift.Config.ENTRY_SSR, writeSSREntry()],
			[Drift.Config.ENTRY_BROWSER, writeBrowserEntry()],
		]

		const writes = await Promise.all(
			files.map(([file, content]) => maybeWrite(path.join(generatedDir, file), content)),
		)

		const changed = writes.some(Boolean)

		// skip when no file changed
		if (changed) await Format.run(Drift.Config.GENERATED_DIR).catch(() => {})

		return changed
	}

	let rebuildRunning = false
	let rebuildQueued = false
	let rebuildReason = 'change'

	const watchCwd = process.cwd().replace(/\\/g, '/')
	const watchAppRoot = `${watchCwd}/${Drift.Config.APP_DIR}/`

	const normaliseWatchPath = (p: string) => p.replace(/\\/g, '/')
	const toAbsoluteWatchPath = (p: string) =>
		normaliseWatchPath(path.isAbsolute(p) ? p : path.join(watchCwd, p))
	const inAppDir = (p: string) => toAbsoluteWatchPath(p).startsWith(watchAppRoot)

	const routeFile = /\/\+(layout|page|404|loading|middleware|endpoint)\.(t|j)sx?$/
	const endpointFile = /\/\+endpoint\.(t|j)sx?$/

	const rebuild = Time.debounce((event: string, p: string) => {
		const queue = () => {
			void (async () => {
				if (rebuildRunning) {
					rebuildQueued = true
					return
				}

				rebuildRunning = true

				do {
					rebuildQueued = false

					try {
						const changed = await build()

						if (changed) {
							logger.info('[watch]', `route graph rebuilt (${rebuildReason})`)
						}
					} catch (err) {
						logger.error('[watch] route rebuild failed', err)
					}
				} while (rebuildQueued)

				rebuildRunning = false
			})()
		}

		if (!inAppDir(p)) return

		const file = toAbsoluteWatchPath(p)

		if (event === 'addDir' || event === 'unlinkDir') {
			rebuildReason = `${event}: ${path.relative(watchCwd, file)}`
			queue()
			return
		}

		if (!routeFile.test(file)) return

		// content changes only matter for route graph when endpoint verbs change
		if (event === 'change' && !endpointFile.test(file)) return

		rebuildReason = `${event}: ${path.relative(watchCwd, file)}`
		queue()
	}, 75)

	const plugin = {
		name: 'drift',
		enforce: 'pre' as const,
		async config(viteConfig: UserConfig) {
			await build()

			try {
				Drift.getVersion()
			} catch {
				const value = JSON.parse(
					fsSync.readFileSync(new URL('../package.json', import.meta.url), 'utf-8'),
				) as { version?: unknown }

				if (typeof value.version !== 'string' || value.version.length === 0) {
					throw new Error('Missing drift package version')
				}

				Drift.setVersion(value.version)
			}

			viteConfig.build ??= {}
			viteConfig.build.outDir = config.outDir
			viteConfig.build.emptyOutDir = true

			viteConfig.server ??= {}
			viteConfig.server.port = 8787

			viteConfig.define ??= {}
			viteConfig.define['import.meta.env.APP_URL'] = JSON.stringify(process.env.APP_URL)
			viteConfig.define['import.meta.env.VITE_APP_URL'] = JSON.stringify(
				process.env.VITE_APP_URL,
			)
			viteConfig.define['import.meta.env.DRIFT_VERSION'] = JSON.stringify(
				Drift.getVersion(),
			)

			viteConfig.resolve ??= {}
			viteConfig.resolve.alias = {
				...(viteConfig.resolve.alias ?? {}),
				'.drift': path.resolve(process.cwd(), Drift.Config.GENERATED_DIR),
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
			logger.info(
				'[configureServer]',
				`Watching for changes in ./${Drift.Config.APP_DIR}...`,
			)

			server.watcher
				.on('add', (p: string) => rebuild('add', p))
				.on('change', (p: string) => rebuild('change', p))
				.on('unlink', (p: string) => rebuild('unlink', p))
				.on('addDir', (p: string) => rebuild('addDir', p))
				.on('unlinkDir', (p: string) => rebuild('unlinkDir', p))
		},
		async closeBundle() {
			if (process.env.NODE_ENV === 'development') return

			// write build manifest
			const generatedDir = path.join(process.cwd(), Drift.Config.GENERATED_DIR)

			await Bun.write(
				path.join(generatedDir, 'build.json'),
				JSON.stringify({
					prerenderedRoutes: Array.from(buildContext.prerenderedRoutes),
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
				rsc: `./${Drift.Config.GENERATED_DIR}/${Drift.Config.ENTRY_RSC}`,
				ssr: `./${Drift.Config.GENERATED_DIR}/${Drift.Config.ENTRY_SSR}`,
				client: `./${Drift.Config.GENERATED_DIR}/${Drift.Config.ENTRY_BROWSER}`,
			},
		}),
		react(),
	]
}

export default drift

export * from './types'

export { Drift } from './drift'

export type * from './drift.d.ts'
