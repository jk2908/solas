import fs from 'node:fs/promises'
import path from 'node:path'

import * as Compress from '../utils/compress.js'
import { Logger } from '../utils/logger.js'

import type { BuildManifest, CspConfig } from '../types.js'
import * as Config from '../config.js'
import * as Manifest from '../manifest.js'
import { CspHash } from './csp-hash.js'
import * as Prerender from './prerender.js'

const logger = new Logger()

/**
 * Overrides the RSC bundle that postbuild imports to prerender routes. Defaults
 * to `dist/rsc/index.js`; platform adapters that relocate the server bundle (for
 * example Cloudflare, whose Worker bundle lives under `.cloudflare`) set this.
 */
let rscEntryOverride: string | undefined

export function setRscEntry(entry: string) {
	rscEntryOverride = entry
}

type App = Parameters<typeof Prerender.run>[0]

/** Imports the server bundle `postbuild` prerenders with. */
export type PrerenderImport = () => Promise<{ default: App }>

let prerenderImport: ((next: PrerenderImport) => PrerenderImport) | undefined

/**
 * Set a wrapper for the import `postbuild` makes to prerender. It receives the
 * plain import and returns one that sets up and tears down platform-specific
 * module resolution around it, for example shimming a runtime module that Node
 * cannot resolve (such as `cloudflare:workers`).
 */
export function setPrerenderImport(wrap: (next: PrerenderImport) => PrerenderImport) {
	prerenderImport = wrap
}

export async function postbuild(cwd: string = process.cwd(), csp?: CspConfig) {
	const manifestPath = path.join(cwd, Config.GENERATED_DIR, 'build.json')

	let manifest: BuildManifest

	try {
		const raw = await fs.readFile(manifestPath, 'utf-8')
		manifest = JSON.parse(raw)
	} catch (err) {
		logger.error('[build] failed to read build manifest', err)
		throw err
	}

	const outDir = path.resolve(cwd, Config.OUT_DIR)
	const rscDir = path.join(outDir, 'rsc')
	const artifactRoot = Prerender.getArtifactRootPath(outDir)
	const staticRoot = path.join(outDir, 'static')
	const staticMode = manifest.trailingSlash === 'always' ? 'always' : 'never'

	// clear old prerender artifacts and static output so routes that have
	// switched modes do not keep stale files from a previous build
	await Promise.all([
		fs.rm(artifactRoot, { recursive: true, force: true }),
		fs.rm(staticRoot, { recursive: true, force: true }),
	])

	const artfifactManifest: Prerender.ArtifactManifest = {}

	if (manifest.prerenderRoutes.length > 0) {
		const concurrency = Prerender.getConcurrency()
		const pendingWrites = new Set<Promise<void>>()

		logger.info(
			'[prerender]',
			`prerendering ${manifest.prerenderRoutes.length} routes (concurrency: ${concurrency})...`,
		)

		const rscEntry = rscEntryOverride ?? path.join(rscDir, 'index.js')
		rscEntryOverride = undefined

		const base: PrerenderImport = () => import(/* @vite-ignore */ rscEntry)
		const load = prerenderImport ? prerenderImport(base) : base
		prerenderImport = undefined

		const { default: app } = await load()

		async function enqueueWrite(task: () => Promise<void>) {
			const write = task().finally(() => {
				pendingWrites.delete(write)
			})

			pendingWrites.add(write)

			if (pendingWrites.size >= concurrency) {
				await Promise.race(pendingWrites)
			}
		}

		for await (const result of Prerender.run(app, manifest.prerenderRoutes, {
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
			const artifactDir = Prerender.getArtifactPath(outDir, route)
			const csp = CspHash.collect(artifact.html)
			const cspHashes = csp.script.length > 0 || csp.style.length > 0 ? { csp } : {}

			await enqueueWrite(async () => {
				try {
					if (artifact.mode === 'ppr') {
						await fs.mkdir(artifactDir, { recursive: true })

						const writes: Promise<void>[] = [
							fs.writeFile(path.join(artifactDir, 'prelude.html'), artifact.html),
							fs.writeFile(
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
								fs.writeFile(
									path.join(artifactDir, 'postponed.json'),
									JSON.stringify(artifact.postponed),
								),
							)
						}

						await Promise.all(writes)

						artfifactManifest[route] = {
							mode: artifact.mode,
							files:
								artifact.postponed !== undefined
									? ['metadata', 'prelude', 'postponed']
									: ['metadata', 'prelude'],
							...cspHashes,
						}

						logger.info('[prerender]', `${route} (ppr)`)
						return
					}

					// full prerenders are emitted at their real route path so a static
					// asset host can serve them directly, without invoking the server
					const staticPath = path.join(
						staticRoot,
						Prerender.staticRoutePath(route, staticMode),
					)

					await fs.mkdir(path.dirname(staticPath), { recursive: true })
					await fs.writeFile(staticPath, artifact.html)

					// a static host has no server to answer an RSC navigation, so emit
					// the payload next to the HTML for the client router to fetch
					if (manifest.adapter === 'static') {
						await fs.writeFile(
							staticPath.replace(/\.html$/, '.rsc.txt'),
							await Prerender.getRscPayload(app, route, {
								origin: manifest.url,
								base: manifest.base,
							}),
						)
					}

					artfifactManifest[route] = {
						mode: artifact.mode,
						files: ['html'],
						...cspHashes,
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

	// generated files served at the root: written to the output root (for the
	// asset layer) and into the client output (for the Node server), then listed
	// as public files so every runtime serves them
	const generatedPublicFiles: string[] = []

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

		// point robots.txt at the sitemap, unless the app ships its own
		const robots = manifest.publicFiles.some(
			file => file.replace(/^\//, '') === 'robots.txt',
		)
			? null
			: ['User-agent: *', 'Allow: /', '', `Sitemap: ${origin}/sitemap.xml`, ''].join('\n')

		const clientDir = path.join(outDir, 'client')
		await fs.mkdir(clientDir, { recursive: true })

		const writes = [
			fs.writeFile(path.join(outDir, 'sitemap.xml'), sitemap),
			fs.writeFile(path.join(clientDir, 'sitemap.xml'), sitemap),
		]

		generatedPublicFiles.push('/sitemap.xml')
		logger.info('[sitemap]', `generated ${manifest.sitemapRoutes.length} urls`)

		if (robots) {
			writes.push(
				fs.writeFile(path.join(outDir, 'robots.txt'), robots),
				fs.writeFile(path.join(clientDir, 'robots.txt'), robots),
			)

			generatedPublicFiles.push('/robots.txt')
			logger.info('[robots]', 'generated robots.txt')
		}

		await Promise.all(writes)
	}

	const runtimeManifest = {
		artifacts: artfifactManifest,
		publicFiles: [...manifest.publicFiles, ...generatedPublicFiles],
		csp,
		trailingSlash: manifest.trailingSlash,
	}

	await fs.writeFile(Manifest.getManifestPath(outDir), JSON.stringify(runtimeManifest))

	if (manifest.precompress) {
		logger.info('[precompress]', 'compressing assets...')

		for await (const { input, compressed } of Compress.run(outDir, {
			filter: filePath => {
				const relativePath = path.relative(outDir, filePath)

				if (
					relativePath.length === 0 ||
					relativePath.startsWith('..') ||
					path.isAbsolute(relativePath)
				) {
					return false
				}

				const normalisedPath = relativePath.split(path.sep).join('/')

				// browser-served client assets and static prerendered routes benefit
				// from generic precompression; internal ppr support files are read by
				// the server rather than served raw to browsers
				if (
					normalisedPath.startsWith('client/') ||
					normalisedPath.startsWith('static/')
				) {
					return /\.(js|css|html|svg|json|txt)$/.test(normalisedPath)
				}

				return false
			},
		})) {
			await fs.writeFile(`${input}.br`, compressed)
			logger.info('[precompress]', `${path.basename(input)}.br`)
		}
	}

	await fs.unlink(manifestPath).catch(() => {})

	logger.info('[build]', 'done')
}
