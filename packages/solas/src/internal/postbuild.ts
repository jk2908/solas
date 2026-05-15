import fs from 'node:fs/promises'
import path from 'node:path'

import { Compress } from '../utils/compress.js'
import { Logger } from '../utils/logger.js'

import type { BuildManifest } from '../types.js'
import { Solas } from '../solas.js'
import { Prerender } from './prerender.js'

const logger = new Logger()

export async function postbuild(cwd: string = process.cwd()) {
	const manifestPath = path.join(cwd, Solas.Config.GENERATED_DIR, 'build.json')

	let manifest: BuildManifest

	try {
		const raw = await fs.readFile(manifestPath, 'utf-8')
		manifest = JSON.parse(raw)
	} catch (err) {
		logger.error('[build] failed to read build manifest', err)
		throw err
	}

	const outDir = path.resolve(cwd, Solas.Config.OUT_DIR)
	const rscDir = path.join(outDir, 'rsc')
	const artifactRoot = Prerender.Artifact.getRootPath(outDir)

	// clear old prerender artifacts so routes that have switched modes
	// do not keep stale metadata from a previous build
	await fs.rm(artifactRoot, { recursive: true, force: true })

	const artifactManifest: Prerender.Artifact.Manifest = {}

	if (manifest.prerenderRoutes.length > 0) {
		const concurrency = Prerender.Build.getConcurrency()
		const pendingWrites = new Set<Promise<void>>()

		logger.info(
			'[prerender]',
			`prerendering ${manifest.prerenderRoutes.length} routes (concurrency: ${concurrency})...`,
		)

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

		for await (const result of Prerender.Build.run(app, manifest.prerenderRoutes, {
			base: manifest.base,
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

					await fs.mkdir(artifactDir, { recursive: true })

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
							Prerender.Artifact.getFilePath(
								outDir,
								route,
								Prerender.Artifact.FULL_PRERENDER_FILENAME,
							),
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
	}

	await fs.mkdir(artifactRoot, { recursive: true })

	const runtimeManifest = {
		artifacts: artifactManifest,
		publicFiles: manifest.publicFiles,
	}

	await Bun.write(
		Solas.Runtime.getManifestPath(outDir),
		JSON.stringify(runtimeManifest),
	)

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

	if (manifest.precompress) {
		logger.info('[precompress]', 'compressing assets...')

		for await (const { input, compressed } of Compress.run(outDir, {
			filter: f => /\.(js|css|html|svg|json|txt)$/.test(f),
		})) {
			await Bun.write(`${input}.br`, compressed)
			logger.info('[precompress]', `${path.basename(input)}.br`)
		}
	}

	await fs.unlink(manifestPath).catch(() => {})

	logger.info('[build]', 'done')
}
