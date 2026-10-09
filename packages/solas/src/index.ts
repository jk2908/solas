import fsSync from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

import {
	createRunnableDevEnvironment,
	resolveConfig,
	type PluginOption,
	type ResolvedConfig,
	type RunnableDevEnvironment,
	type UserConfig,
	type ViteDevServer,
} from 'vite'

import rsc from '@vitejs/plugin-rsc'

import { ExportReader } from './utils/export-reader.js'
import { Logger } from './utils/logger.js'
import { debounce } from './utils/time.js'

import type {
	BuildContext,
	ConfiguredPluginConfig,
	Origin,
	PluginConfig,
} from './types.js'
import * as Config from './config.js'
import * as Build from './internal/build.js'
import { writeConfig } from './internal/codegen/config.js'
import {
	writeBrowserEntry,
	writeRSCEntry,
	writeSSREntry,
} from './internal/codegen/environments.js'
import { format as formatSource } from './internal/codegen/format.js'
import { writeManifest } from './internal/codegen/manifest.js'
import { writeMaps } from './internal/codegen/maps.js'
import { writeTypes } from './internal/codegen/types.js'
import { postbuild } from './internal/postbuild.js'
import { collect as collectPublicFiles } from './internal/public-files.js'

const DEFAULT_CONFIG = {
	precompress: false,
	prerender: false,
	trustedOrigins: [],
	trailingSlash: 'never',
} as const satisfies Partial<PluginConfig>

function solas(c?: PluginConfig): PluginOption[] {
	const validatedConfig = Config.validate(c)
	const config: ConfiguredPluginConfig = {
		...DEFAULT_CONFIG,
		...validatedConfig,
	}

	const envUrl = process.env.VITE_APP_URL?.toString()
	let resolvedUrl: Origin | undefined =
		c?.url ?? (envUrl && envUrl.length > 0 ? (envUrl as Origin) : undefined)

	if (config.logger?.level) Logger.defaultLevel = config.logger.level

	const logger = new Logger()
	const exportReader = new ExportReader()

	const buildContext: BuildContext = {
		prerenderRoutes: new Set<string>(),
		knownRoutes: new Set<string>(),
		exportReader,
	}

	// cache for file contents to avoid unnecessary readFile invocations
	const fileCache = new Map<string, string>()

	async function maybeWrite(filePath: string, content: string) {
		try {
			const cached = fileCache.get(filePath)

			if (cached === content) {
				// if content is unchanged and file exists, skip write
				if (
					await fs
						.access(filePath)
						.then(() => true)
						.catch(() => false)
				)
					return null

				// else, file is missing but cached content is the same as
				// last time we saw it, write it
				await fs.writeFile(filePath, content)
				fileCache.set(filePath, content)

				return path.relative(process.cwd(), filePath)
			}

			const curr = cached ?? (await fs.readFile(filePath, 'utf-8'))
			fileCache.set(filePath, curr)

			// no change, bail
			if (curr === content) return null

			try {
				await fs.writeFile(filePath, content)
				fileCache.set(filePath, content)

				return path.relative(process.cwd(), filePath)
			} catch (err) {
				logger.error(`[maybeWrite] Failed to write file: ${filePath}`, err)
				return null
			}
		} catch (err) {
			// file doesn't exist, write it
			if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
				try {
					await fs.writeFile(filePath, content)
					fileCache.set(filePath, content)

					return path.relative(process.cwd(), filePath)
				} catch (err) {
					logger.error(`[maybeWrite] Failed to write file: ${filePath}`, err)
					return null
				}
			}

			logger.error(`[maybeWrite] Failed to read file: ${filePath}`, err)

			return null
		}
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
		const { manifest, prerenderRoutes, knownRoutes, imports, modules } =
			await processor.run()

		buildContext.prerenderRoutes = prerenderRoutes
		buildContext.knownRoutes = knownRoutes

		const files: [string, string][] = [
			['config.ts', writeConfig(config)],
			['manifest.ts', writeManifest(manifest)],
			['maps.ts', writeMaps(imports, modules)],
			[`${Config.SLUG}.d.ts`, writeTypes(manifest)],
			[Config.ENTRY_RSC, writeRSCEntry(config)],
			[Config.ENTRY_SSR, writeSSREntry()],
			[Config.ENTRY_BROWSER, writeBrowserEntry()],
		]

		// remove generated files no longer emitted by the current codegen, so
		// old artifacts don't linger and break module resolution. keep
		// closeBundle's build.json, which lives in the same directory
		const currentFiles = new Set(files.map(([file]) => file))
		const existing = await fs
			.readdir(generatedDir, { withFileTypes: true })
			.catch(() => [])
		await Promise.all(
			existing
				.filter(
					entry =>
						entry.isFile() &&
						entry.name !== 'build.json' &&
						!currentFiles.has(entry.name),
				)
				.map(entry => fs.rm(path.join(generatedDir, entry.name), { force: true })),
		)

		const writes = await Promise.all(
			files.map(async ([file, content]) => {
				const formatted = await formatSource(file, content)

				return maybeWrite(path.join(generatedDir, file), formatted)
			}),
		)

		const changed = writes.filter(n => n !== null)
		// early return if nothing has changed
		if (!changed.length) return

		return changed
	}

	let rebuildRunning = false
	let rebuildQueued = false
	let rebuildReason = 'change'

	// normalise all watcher paths to forward slashes so path checks behave the
	// same on Windows and POSIX
	const WATCH_CWD = process.cwd().replace(/\\/g, '/')
	const WATCH_APP_ROOT = `${WATCH_CWD}/${Config.APP_DIR}/`

	// convert watcher paths to a consistent slash format before comparing them
	const normaliseWatchPath = (p: string) => p.replace(/\\/g, '/')

	// resolve relative watcher paths against the project root so prefix checks are reliable
	const toAbsoluteWatchPath = (p: string) =>
		normaliseWatchPath(path.isAbsolute(p) ? p : path.join(WATCH_CWD, p))

	// only route changes inside the app directory should trigger a rebuild
	const inAppDir = (p: string) => toAbsoluteWatchPath(p).startsWith(WATCH_APP_ROOT)

	// route graph rebuilds only care about framework route files, with endpoint
	// edits needing special treatment because verb exports can change in-place
	const routeFile =
		/\/\+(layout|page|401|403|404|500|loading|middleware|endpoint)\.(t|j)sx?$/
	const endpointFile = /\/\+endpoint\.(t|j)sx?$/

	const rebuild = debounce((event: string, p: string) => {
		const queue = () => {
			void (async () => {
				// collapse bursts of file events into one active rebuild plus a single
				// queued rerun when changes land mid-build
				if (rebuildRunning) {
					rebuildQueued = true
					return
				}

				rebuildRunning = true

				do {
					rebuildQueued = false

					try {
						const changed = await build()

						if (changed) logger.info('[watch]', `route graph rebuilt (${rebuildReason})`)
					} catch (err) {
						logger.error('[watch] route rebuild failed', err)
					}
				} while (rebuildQueued)
				rebuildRunning = false
			})()
		}

		// ignore anything outside the app dir
		if (!inAppDir(p)) return

		const file = toAbsoluteWatchPath(p)

		// directory adds/removals can change route structure immediately
		if (event === 'addDir' || event === 'unlinkDir') {
			rebuildReason = `${event}: ${path.relative(WATCH_CWD, file)}`
			queue()
			return
		}

		// non-route files do not affect generated route artifacts
		if (!routeFile.test(file)) return

		// content changes only matter for route graph when endpoint verbs change
		if (event === 'change' && !endpointFile.test(file)) return

		rebuildReason = `${event}: ${path.relative(WATCH_CWD, file)}`
		queue()
	}, 75)

	let resolvedViteConfig: ResolvedConfig | null = null
	let scanEnvironment: RunnableDevEnvironment | null = null

	// route modules are executed at build time to read `prerender` flags and call
	// `params()`
	async function getScanEnvironment() {
		if (scanEnvironment) return scanEnvironment
		if (!resolvedViteConfig) throw new Error('Vite config not resolved yet')

		const scanConfig = await resolveConfig(
			{
				configFile: resolvedViteConfig.configFile ?? undefined,
				root: resolvedViteConfig.root,
				mode: resolvedViteConfig.mode,
			},
			'serve',
		)

		const environment = createRunnableDevEnvironment('ssr', scanConfig, {
			hot: false,
			// Vite 8 enables full bundle mode (Rolldown) by default, which is only
			// supported for the client environment. The scan environment is a
			// plain per-module dev environment used to execute route files,
			// so opt out
			options: { isBundled: false },
		})

		await environment.init()
		scanEnvironment = environment

		return environment
	}

	const plugin = {
		name: Config.NAME,
		async config(viteConfig: UserConfig) {
			const pkg = JSON.parse(
				fsSync.readFileSync(new URL('../package.json', import.meta.url), 'utf-8'),
			)

			if (typeof pkg.name !== 'string' || pkg.name.length === 0) {
				throw new Error(`Missing ${Config.NAME} package name`)
			}

			if (typeof pkg.version !== 'string' || pkg.version.length === 0) {
				throw new Error(`Missing ${Config.NAME} package version`)
			}

			viteConfig.build ??= {}
			viteConfig.build.outDir = Config.OUT_DIR
			// keep framework files under one reserved url prefix
			viteConfig.build.assetsDir = Config.ASSETS_DIR
			viteConfig.build.emptyOutDir = true
			// let users move the source public folder if they want
			viteConfig.publicDir ??= Config.PUBLIC_DIR

			viteConfig.server ??= {}
			viteConfig.server.port ??= 8787

			// derive the public url from vite's dev server settings when no
			// origin was set explicitly via the url option or VITE_APP_URL
			if (resolvedUrl === undefined) {
				const { host, port } = viteConfig.server
				const hostname =
					typeof host === 'string' && host.length > 0 && host !== '0.0.0.0'
						? host
						: 'localhost'

				resolvedUrl = `http://${hostname}:${port}` as Origin
			}

			viteConfig.define ??= {}
			viteConfig.define['import.meta.env.VITE_APP_URL'] = JSON.stringify(resolvedUrl)
			viteConfig.define['import.meta.env.SOLAS_VERSION'] = JSON.stringify(pkg.version)

			viteConfig.optimizeDeps ??= {}
			viteConfig.optimizeDeps.exclude = [
				...new Set([
					...(viteConfig.optimizeDeps.exclude ?? []),
					pkg.name,
					`${pkg.name}/env/browser`,
					`${pkg.name}/router`,
				]),
			]

			viteConfig.resolve ??= {}
			viteConfig.resolve.alias = Array.isArray(viteConfig.resolve.alias)
				? [
						...viteConfig.resolve.alias,
						{
							find: '.solas',
							replacement: path.resolve(process.cwd(), Config.GENERATED_DIR),
						},
					]
				: {
						...viteConfig.resolve.alias,
						'.solas': path.resolve(process.cwd(), Config.GENERATED_DIR),
					}
		},
		configResolved(resolvedConfig: ResolvedConfig) {
			resolvedViteConfig = resolvedConfig
			buildContext.command = resolvedConfig.command
		},
		configureServer(server: ViteDevServer) {
			logger.info('[configureServer]', `Watching for changes in ./${Config.APP_DIR}...`)

			server.watcher
				.on('add', (p: string) => rebuild('add', p))
				.on('change', (p: string) => rebuild('change', p))
				.on('unlink', (p: string) => rebuild('unlink', p))
				.on('addDir', (p: string) => rebuild('addDir', p))
				.on('unlinkDir', (p: string) => rebuild('unlinkDir', p))
		},
		async buildStart() {
			logger.info('[buildStart]', 'building route graph...')

			// attach a module loader for ExportReader.value to execute route modules
			if (buildContext.command === 'build') {
				const environment = await getScanEnvironment()

				buildContext.exportReader.loadModule = (filePath: string) =>
					environment.runner.import(filePath)
			}

			await build()
		},
		async closeBundle() {
			if (scanEnvironment) {
				const environment = scanEnvironment

				scanEnvironment = null
				await environment.close()
			}

			// resolve sitemap routes
			let sitemapRoutes: string[] = []

			if (config.sitemap && resolvedUrl) {
				const auto = [
					...new Set([...buildContext.knownRoutes, ...buildContext.prerenderRoutes]),
				]

				if (typeof config.sitemap === 'object' && config.sitemap.routes) {
					sitemapRoutes = await config.sitemap.routes(auto)
				} else {
					sitemapRoutes = auto
				}
			}

			// write build manifest
			const generatedDir = path.join(process.cwd(), Config.GENERATED_DIR)

			await fs.writeFile(
				path.join(generatedDir, 'build.json'),
				JSON.stringify({
					base: resolvedViteConfig?.base ?? '/',
					publicFiles: await collectPublicFiles(resolvedViteConfig?.publicDir),
					prerenderRoutes: Array.from(buildContext.prerenderRoutes),
					sitemapRoutes,
					precompress: config.precompress,
					trailingSlash: config.trailingSlash,
					url: resolvedUrl,
				}),
			)
		},
		buildApp: {
			order: 'post' as const,
			async handler() {
				await postbuild(resolvedViteConfig?.root ?? process.cwd())
			},
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
		...(config.adapter?.plugins ?? []),
	]
}

export default solas
export * as Solas from './solas.js'
export type * from './types.js'
