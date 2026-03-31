#!/usr/bin/env bun
import fs from 'node:fs/promises'
import path from 'node:path'

import type { BuildManifest } from './types'

import { Solas } from './solas'

import { Compress } from './utils/compress'
import { Logger } from './utils/logger'

import { Prerender } from './internal/prerender'

const logger = new Logger()
const DEFAULT_PREVIEW_PORT = 4173

/**
 * The build command does more than just run vite build - it also handles prerendering and
 * precompressing assets. This is because prerendering needs to run against the built
 * server entry to ensure the same code paths as preview, and precompressing needs
 * to include the prerendered html and json files
 */
async function build() {
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
	} catch {
		logger.error('[build] failed to read build manifest')
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
		const artifactManifestRoutes: Prerender.Artifact.Manifest['routes'] = {}

		logger.info(
			'[prerender]',
			`prerendering ${manifest.prerenderRoutes.length} routes (timeout: ${timeout}ms, concurrency: ${concurrency})...`,
		)

		// load the built server entry and render each prerendered route through it

		const rscEntry = path.join(rscDir, 'index.js')
		const { default: app } = await import(/* @vite-ignore */ rscEntry)

		// run prerender through the built app so build output uses the same path as preview
		for await (const result of Prerender.Build.run(app, manifest.prerenderRoutes, {
			timeout,
			concurrency,
			origin: manifest.url,
		})) {
			const route = result.route

			try {
				// store prerender metadata for this route under the framework folder
				const artifactDir = Prerender.Artifact.getPath(outDir, route)

				if ('error' in result) throw result.error

				if ('status' in result) {
					logger.warn('[prerender]', `skipped ${route}: ${result.status}`)
					continue
				}

				const artifact = result.artifact

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

					artifactManifestRoutes[route] = {
						mode: artifact.mode,
						createdAt: artifact.createdAt,
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
					continue
				}

				// @todo: hash files

				// full prerender still keeps metadata so preview knows to serve saved html
				await fs.mkdir(artifactDir, { recursive: true })

				await Bun.write(
					path.join(artifactDir, 'metadata.json'),
					JSON.stringify({
						schema: artifact.schema,
						route: artifact.route,
						createdAt: artifact.createdAt,
						mode: artifact.mode,
					}),
				)

				const routePath = route.replace(/^\//, '').replace(/\/$/, '')
				const outPath =
					route === '/'
						? path.join(outDir, 'index.html')
						: manifest.trailingSlash === 'always'
							? path.join(outDir, routePath, 'index.html')
							: path.join(outDir, `${routePath}.html`)

				// remove the old file shape for this route so switching trailingSlash mode does not leave
				// both variants behind. we have to do this before writing the new file so that if the
				// route shape changes, we still remove the old one instead of leaving in the output
				const alternateOutPath =
					route === '/'
						? null
						: manifest.trailingSlash === 'always'
							? path.join(outDir, `${routePath}.html`)
							: path.join(outDir, routePath, 'index.html')

				if (alternateOutPath) {
					// remove the old file shape so switching trailingSlash mode
					// does not leave both variants behind
					await Promise.all([
						fs.rm(alternateOutPath, { force: true }),
						fs.rm(`${alternateOutPath}.br`, { force: true }),
					])

					await fs.rmdir(path.dirname(alternateOutPath)).catch(() => {})
				}

				await fs.mkdir(path.dirname(outPath), { recursive: true })
				await Bun.write(outPath, artifact.html)

				artifactManifestRoutes[route] = {
					mode: artifact.mode,
					createdAt: artifact.createdAt,
					files: ['metadata', 'html'],
				}

				logger.info('[prerender]', `${route} (full)`)
			} catch (err) {
				logger.error(
					'[prerender]',
					`failed ${route}: ${err}. This often means unresolved async work (for example external fetches or dynamic rendering in full mode).`,
				)
			}
		}

		// write one manifest for the saved prerender files after all routes finish
		await fs.mkdir(artifactRoot, { recursive: true })

		await Bun.write(
			Prerender.Artifact.getManifestPath(outDir),
			JSON.stringify({
				generatedAt: Date.now(),
				routes: artifactManifestRoutes,
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

async function dev() {
	const proc = Bun.spawn(['bunx', '--bun', 'vite', 'dev'], {
		cwd: process.cwd(),
		stdout: 'inherit',
		stderr: 'inherit',
		stdin: 'inherit',
		env: { ...process.env, NODE_ENV: 'development' },
	})

	await proc.exited
}

async function preview() {
	// preview should behave like production, not like vite dev
	process.env.NODE_ENV = 'production'

	const cwd = process.cwd()
	const outDir = path.resolve(cwd, Solas.Config.OUT_DIR)
	const rscDir = path.join(outDir, 'rsc')
	const rscEntry = path.join(rscDir, 'index.js')

	const portFlagIndex = args.findIndex(arg => arg === '--port' || arg === '-p')
	const parsedPort =
		portFlagIndex >= 0 && args[portFlagIndex + 1]
			? Number(args[portFlagIndex + 1])
			: DEFAULT_PREVIEW_PORT

	// fail fast if the port is invalid
	if (!Number.isInteger(parsedPort) || parsedPort <= 0 || parsedPort > 65535) {
		logger.error(`[preview] invalid port: ${args[portFlagIndex + 1] ?? 'undefined'}`)
		process.exit(1)
	}

	// the built server entry handles routing, prerendered html, and ssr here
	try {
		await fs.access(rscEntry)
	} catch {
		logger.error(
			`[preview] missing ${path.relative(cwd, rscEntry)} - run \`${Solas.Config.SLUG} build\` first`,
		)
		process.exit(1)
	}

	const { default: app } = await import(/* @vite-ignore */ rscEntry)

	try {
		// keep the preview server thin and let the app handle requests
		Bun.serve({
			port: parsedPort,
			fetch: app.fetch,
		})
	} catch (err) {
		logger.error(`[preview] failed to start on port ${parsedPort}: ${err}`)
		process.exit(1)
	}

	logger.info('[preview]', `server running at http://localhost:${parsedPort}`)

	// keep the process running after the server starts
	await new Promise(() => {})
}

// read the subcommand once and dispatch below
const [, , command, ...args] = process.argv

switch (command) {
	case 'build':
		await build()
		break
	case 'dev':
		await dev()
		break
	case 'preview':
		await preview()
		break
	default:
		console.log(`
			${Solas.Config.NAME} - cli

			Commands:
				build    Build for production (vite build + prerender + compress)
				dev      Start development server
				preview  Preview production build (serves prerendered HTML with SSR fallback)
		`)

		process.exit(command ? 1 : 0)
}
