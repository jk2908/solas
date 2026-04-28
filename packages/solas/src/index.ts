import fsSync from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

import type { PluginOption, UserConfig, ViteDevServer } from 'vite'

import rsc from '@vitejs/plugin-rsc'

import { ExportReader } from './utils/export-reader.js'
import { Logger } from './utils/logger.js'
import { Time } from './utils/time.js'

import type { BuildContext, PluginConfig } from './types.js'
import { Build } from './internal/build.js'
import { writeConfig } from './internal/codegen/config.js'
import {
	writeBrowserEntry,
	writeRSCEntry,
	writeSSREntry,
} from './internal/codegen/environments.js'
import { writeManifest } from './internal/codegen/manifest.js'
import { writeMaps } from './internal/codegen/maps.js'
import { writeTypes } from './internal/codegen/types.js'
import { Solas } from './solas.js'

const DEFAULT_CONFIG = {
	precompress: true,
	prerender: false,
	trailingSlash: 'never',
} as const satisfies Partial<PluginConfig>

function solas(c: PluginConfig): PluginOption[] {
	const config = Solas.Config.validate({
		...DEFAULT_CONFIG,
		...c,
		url: c.url ?? process.env.VITE_APP_URL?.toString(),
	})

	if (config.logger?.level) Logger.defaultLevel = config.logger.level

	const logger = new Logger()
	const exportReader = new ExportReader()

	const buildContext = {
		prerenderRoutes: new Set<string>(),
		knownRoutes: new Set<string>(),
		exportReader,
	} satisfies BuildContext

	// cache for file contents to avoid unnecessary readFile invocations
	const fileCache = new Map<string, string>()

	async function maybeWrite(filePath: string, content: string) {
		try {
			const cached = fileCache.get(filePath)

			if (cached === content) {
				// if content is unchanged and file exists, skip write
				if (await Bun.file(filePath).exists()) return null

				// else, file is missing but cached content is the same as
				// last time we saw it, write it
				await Bun.write(filePath, content)
				fileCache.set(filePath, content)

				return path.relative(process.cwd(), filePath)
			}

			const curr = cached ?? (await fs.readFile(filePath, 'utf-8'))
			fileCache.set(filePath, curr)

			// no change, bail
			if (curr === content) return null

			try {
				await Bun.write(filePath, content)
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
					await Bun.write(filePath, content)
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
		const routesDir = path.join(cwd, Solas.Config.APP_DIR)
		const generatedDir = path.join(cwd, Solas.Config.GENERATED_DIR)

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
			[`${Solas.Config.SLUG}.d.ts`, writeTypes(manifest)],
			[Solas.Config.ENTRY_RSC, writeRSCEntry()],
			[Solas.Config.ENTRY_SSR, writeSSREntry()],
			[Solas.Config.ENTRY_BROWSER, writeBrowserEntry()],
		]

		const writes = await Promise.all(
			files.map(([file, content]) => maybeWrite(path.join(generatedDir, file), content)),
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
	const WATCH_APP_ROOT = `${WATCH_CWD}/${Solas.Config.APP_DIR}/`

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

	const rebuild = Time.debounce((event: string, p: string) => {
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

	const plugin = {
		name: Solas.Config.NAME,
		enforce: 'pre' as const,
		async config(viteConfig: UserConfig) {
			const pkg = JSON.parse(
				fsSync.readFileSync(new URL('../package.json', import.meta.url), 'utf-8'),
			)

			if (typeof pkg.name !== 'string' || pkg.name.length === 0) {
				throw new Error(`Missing ${Solas.Config.NAME} package name`)
			}

			if (typeof pkg.version !== 'string' || pkg.version.length === 0) {
				throw new Error(`Missing ${Solas.Config.NAME} package version`)
			}

			viteConfig.build ??= {}
			viteConfig.build.outDir = Solas.Config.OUT_DIR
			viteConfig.build.emptyOutDir = true

			viteConfig.server ??= {}
			viteConfig.server.port = config.port ?? viteConfig.server.port ?? 8787

			viteConfig.define ??= {}
			viteConfig.define['import.meta.env.VITE_APP_URL'] = JSON.stringify(config.url)
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
							replacement: path.resolve(process.cwd(), Solas.Config.GENERATED_DIR),
						},
					]
				: {
						...viteConfig.resolve.alias,
						'.solas': path.resolve(process.cwd(), Solas.Config.GENERATED_DIR),
					}
		},
		configureServer(server: ViteDevServer) {
			logger.info(
				'[configureServer]',
				`Watching for changes in ./${Solas.Config.APP_DIR}...`,
			)

			server.watcher
				.on('add', (p: string) => rebuild('add', p))
				.on('change', (p: string) => rebuild('change', p))
				.on('unlink', (p: string) => rebuild('unlink', p))
				.on('addDir', (p: string) => rebuild('addDir', p))
				.on('unlinkDir', (p: string) => rebuild('unlinkDir', p))
		},
		async buildStart() {
			logger.info('[buildStart]', 'building route graph...')
			await build()
		},
		async closeBundle() {
			if (process.env.NODE_ENV === 'development') return

			// resolve sitemap routes
			let sitemapRoutes: string[] = []

			if (config.sitemap && config.url) {
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
			const generatedDir = path.join(process.cwd(), Solas.Config.GENERATED_DIR)

			await Bun.write(
				path.join(generatedDir, 'build.json'),
				JSON.stringify({
					prerenderRoutes: Array.from(buildContext.prerenderRoutes),
					sitemapRoutes,
					precompress: config.precompress,
					trailingSlash: config.trailingSlash,
					url: config.url,
				}),
			)

			logger.info('[closeBundle]', 'vite build complete')
		},
	}

	return [
		plugin,
		rsc({
			entries: {
				rsc: `./${Solas.Config.GENERATED_DIR}/${Solas.Config.ENTRY_RSC}`,
				ssr: `./${Solas.Config.GENERATED_DIR}/${Solas.Config.ENTRY_SSR}`,
				client: `./${Solas.Config.GENERATED_DIR}/${Solas.Config.ENTRY_BROWSER}`,
			},
		}),
	]
}

export default solas
export type * from './solas.d.ts'
export { Solas } from './solas.js'
export type * from './types.js'
