import fs from 'node:fs/promises'
import path from 'node:path'

import { Compress } from '../utils/compress.js'
import { Logger } from '../utils/logger.js'

import type { BuildManifest } from '../types.js'
import { Prerender } from '../internal/prerender.js'
import { Solas } from '../solas.js'

const logger = new Logger()

/**
 * The build command does more than just run vite build - it also handles prerendering and
 * precompressing assets. This is because prerendering needs to run against the built
 * server entry to ensure the same code paths as preview, and precompressing needs
 * to include the prerendered html and json files
 */
export async function build() {
	// build and prerender should both run in production mode
	process.env.NODE_ENV = 'production'

	const cwd = process.cwd()
	const manifestPath = path.join(cwd, Solas.Config.GENERATED_DIR, 'build.json')

	// run vite build
	logger.info('[build]', 'running vite build...')

	const vite = Bun.spawnSync(['bunx', '--bun', 'vite', 'build', '--mode', 'production'], {
		cwd,
		stdout: 'inherit',
		stderr: 'inherit',
		env: { ...process.env, NODE_ENV: 'production' },
	})

	if (vite.exitCode !== 0) {
		logger.error('[build] vite build failed')
		process.exit(1)
	}

	// read build manifest
	let manifest: BuildManifest

	try {
		const raw = await fs.readFile(manifestPath, 'utf-8')
		manifest = JSON.parse(raw)
	} catch (err) {
		logger.error('[build] failed to read build manifest', err)
		process.exit(1)
	}

	const outDir = path.resolve(cwd, Solas.Config.OUT_DIR)
	const rscDir = path.join(outDir, 'rsc')
	const artifactRoot = Prerender.Artifact.getRootPath(outDir)

	// clear old prerender artifacts so routes that have switched modes
	// do not keep stale metadata from a previous build
	await fs.rm(artifactRoot, { recursive: true, force: true })

	// prerender routes
	if (manifest.prerenderRoutes.length > 0) {
		const timeout = Prerender.Build.getTimeout()
		const concurrency = Prerender.Build.getConcurrency()

		// track the extra prerender files we write for preview
		const artifactManifest: Prerender.Artifact.Manifest = {}

		// keep in-flight artifact writes bounded so result handling does not block on one route at a time
		const pendingWrites = new Set<Promise<void>>()

		logger.info(
			'[prerender]',
			`prerendering ${manifest.prerenderRoutes.length} routes (timeout: ${timeout}ms, concurrency: ${concurrency})...`,
		)

		// load the built server entry and render each prerendered route through it
		const rscEntry = path.join(rscDir, 'index.js')
		const { default: app } = await import(/* @vite-ignore */ rscEntry)

		async function enqueueWrite(task: () => Promise<void>) {
			const write = task().finally(() => {
				pendingWrites.delete(write)
			})

			pendingWrites.add(write)

			if (pendingWrites.size >= concurrency) {
				await Promise.race(pendingWrites)
			}
		}

		// run prerender through the built app so build output uses the same path as preview
		for await (const result of Prerender.Build.run(app, manifest.prerenderRoutes, {
			timeout,
			concurrency,
			origin: manifest.url,
		})) {
			const route = result.route

			if ('error' in result) {
				logger.error(
					`[prerender]: Failed ${route}: ${result.error}. This often means unresolved async work (for example external fetches or dynamic rendering in full mode)`,
				)
				continue
			}

			if ('status' in result) {
				logger.warn(`[prerender]: Skipped ${route}: ${result.status}`)
				continue
			}

			const artifact = result.artifact
			const artifactDir = Prerender.Artifact.getPath(outDir, route)

			await enqueueWrite(async () => {
				try {
					if (artifact.mode === 'ppr') {
						// for ppr save the shell now and keep the postponed state for later
						await fs.mkdir(artifactDir, { recursive: true })

						const writes: Promise<number>[] = [
							Bun.write(path.join(artifactDir, 'prelude.html'), artifact.html),
							Bun.write(
								path.join(artifactDir, 'metadata.json'),
								JSON.stringify({
									schema: artifact.schema,
									route: artifact.route,
									createdAt: artifact.createdAt,
									mode: artifact.mode,
								}),
							),
						]

						if (artifact.postponed !== undefined) {
							writes.push(
								Bun.write(
									path.join(artifactDir, 'postponed.json'),
									JSON.stringify(artifact.postponed),
								),
							)
						}

						await Promise.all(writes)

						artifactManifest[route] = {
							mode: artifact.mode,
							files:
								artifact.postponed !== undefined
									? ['metadata', 'prelude', 'postponed']
									: ['metadata', 'prelude'],
						}

						logger.info(
							'[prerender:artifacts]',
							JSON.stringify({
								route,
								prelude: artifact.html,
								postponed: artifact.postponed ?? null,
								metadata: {
									schema: artifact.schema,
									route: artifact.route,
									createdAt: artifact.createdAt,
									mode: artifact.mode,
								},
							}),
						)

						logger.info('[prerender]', `${route} (ppr)`)
						return
					}

					// full prerender still keeps metadata so preview knows to serve saved html
					await fs.mkdir(artifactDir, { recursive: true })
					const fullPrerenderFilename = Prerender.Artifact.FULL_PRERENDER_FILENAME

					await Promise.all([
						Bun.write(
							path.join(artifactDir, 'metadata.json'),
							JSON.stringify({
								schema: artifact.schema,
								route: artifact.route,
								createdAt: artifact.createdAt,
								mode: artifact.mode,
							}),
						),
						Bun.write(
							Prerender.Artifact.getFilePath(outDir, route, fullPrerenderFilename),
							artifact.html,
						),
					])

					artifactManifest[route] = {
						mode: artifact.mode,
						files: ['metadata', 'html'],
					}

					logger.info(`[prerender]: ${route} (full)`)
				} catch (err) {
					logger.error(
						`[prerender]: Failed ${route}: ${err}. This often means unresolved async work (for example external fetches or dynamic rendering in full mode).`,
					)
				}
			})
		}

		await Promise.all(pendingWrites)

		// write one manifest for the saved prerender files after all routes finish
		await fs.mkdir(artifactRoot, { recursive: true })

		await Bun.write(
			Prerender.Artifact.getManifestPath(outDir),
			JSON.stringify({
				routes: artifactManifest,
			}),
		)
	}

	// sitemap
	if (manifest.sitemapRoutes.length > 0 && manifest.url) {
		const origin = manifest.url.replace(/\/$/, '')
		const urls = manifest.sitemapRoutes
			.map(route => `  <url><loc>${origin}${route}</loc></url>`)
			.join('\n')

		const sitemap = [
			'<?xml version="1.0" encoding="UTF-8"?>',
			'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
			urls,
			'</urlset>',
		].join('\n')

		await Bun.write(path.join(outDir, 'sitemap.xml'), sitemap)
		logger.info('[sitemap]', `generated ${manifest.sitemapRoutes.length} urls`)
	}

	// precompress
	if (manifest.precompress) {
		logger.info('[precompress]', 'compressing assets...')

		// compress after prerender so generated html and json are included too
		for await (const { input, compressed } of Compress.run(outDir, {
			filter: f => /\.(js|css|html|svg|json|txt)$/.test(f),
		})) {
			await Bun.write(`${input}.br`, compressed)
			logger.info('[precompress]', `${path.basename(input)}.br`)
		}
	}

	// cleanup
	// this file is only needed while the build command is running
	await fs.unlink(manifestPath).catch(() => {})

	logger.info('[build]', 'done')
}
