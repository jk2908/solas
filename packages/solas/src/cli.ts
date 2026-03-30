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

async function build() {
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
	if (manifest.prerenderedRoutes.length > 0) {
		const timeout = Prerender.Build.getTimeout()
		const concurrency = Prerender.Build.getConcurrency()
		const artifactManifestRoutes: Prerender.Artifact.Manifest['routes'] = {}

		logger.info(
			'[prerender]',
			`prerendering ${manifest.prerenderedRoutes.length} routes (timeout: ${timeout}ms, concurrency: ${concurrency})...`,
		)

		// ensure production mode for React
		process.env.NODE_ENV = 'production'

		const rscEntry = path.join(rscDir, 'index.js')
		const { default: app } = await import(/* @vite-ignore */ rscEntry)

		for await (const result of Prerender.Build.run(app, manifest.prerenderedRoutes, {
			timeout,
			concurrency,
		})) {
			const route = result.route

			try {
				const routeDir = route === '/' ? '' : route.replace(/^\//, '')
				// folder for this route's build notes/files
				const artifactDir = Prerender.Artifact.getPath(outDir, route)

				if ('error' in result) throw result.error

				if ('status' in result) {
					logger.warn('[prerender]', `skipped ${route}: ${result.status}`)
					continue
				}

				const artifact = result.artifact

				if (artifact.mode === 'ppr') {
					// for ppr we save the shell now, and the delayed part for later
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

				// even for full pages, write metadata so preview/runtime knows to serve built html
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

				const outPath =
					route === '/'
						? path.join(outDir, 'index.html')
						: path.join(outDir, routeDir, 'index.html')

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

		await fs.mkdir(artifactRoot, { recursive: true })

		await Bun.write(
			Prerender.Artifact.getManifestPath(outDir),
			JSON.stringify({
				generatedAt: Date.now(),
				routes: artifactManifestRoutes,
			}),
		)
	}

	// precompress
	if (manifest.precompress) {
		logger.info('[precompress]', 'compressing assets...')

		for await (const { input, compressed } of Compress.run(outDir, {
			filter: f => /\.(js|css|html|svg|json|txt)$/.test(f),
		})) {
			await Bun.write(`${input}.br`, compressed)
			logger.info('[precompress]', `${path.basename(input)}.br`)
		}
	}

	// cleanup
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

	if (!Number.isInteger(parsedPort) || parsedPort <= 0 || parsedPort > 65535) {
		logger.error(`[preview] invalid port: ${args[portFlagIndex + 1] ?? 'undefined'}`)
		process.exit(1)
	}

	// import RSC server (handles prerendered HTML, static assets, and ssr)
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
		Bun.serve({
			port: parsedPort,
			fetch: app.fetch,
		})
	} catch (err) {
		logger.error(`[preview] failed to start on port ${parsedPort}: ${err}`)
		process.exit(1)
	}

	logger.info('[preview]', `server running at http://localhost:${parsedPort}`)

	// keep alive
	await new Promise(() => {})
}

// cli entry point
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
