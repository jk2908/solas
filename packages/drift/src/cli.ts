#!/usr/bin/env bun
import fs from 'node:fs/promises'
import path from 'node:path'

import type { BuildManifest } from './types'

import { Drift } from './drift'

import { Compress } from './utils/compress'
import { Logger } from './utils/logger'

import { Prerender } from './internal/prerender'

const logger = new Logger()
const DEFAULT_PREVIEW_PORT = 4173

async function build() {
	process.env.NODE_ENV = 'production'

	const cwd = process.cwd()
	const manifestPath = path.join(cwd, Drift.Config.GENERATED_DIR, 'build.json')

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

	const outDir = path.resolve(cwd, manifest.outDir)
	const rscDir = path.join(outDir, 'rsc')

	// prerender routes
	if (manifest.prerenderedRoutes.length > 0) {
		const timeout = Prerender.getTimeout()
		const concurrency = Prerender.getConcurrency()

		logger.info(
			'[prerender]',
			`prerendering ${manifest.prerenderedRoutes.length} routes (timeout: ${timeout}ms, concurrency: ${concurrency})...`,
		)

		// ensure production mode for React
		process.env.NODE_ENV = 'production'

		const rscEntry = path.join(rscDir, 'index.js')
		const { default: app } = await import(/* @vite-ignore */ rscEntry)

		for await (const result of Prerender.run(app, manifest.prerenderedRoutes, {
			timeout,
			concurrency,
		})) {
			const route = result.route

			try {
				const routeDir = route === '/' ? '' : route.replace(/^\//, '')

				if ('error' in result) {
					throw result.error
				}

				if ('status' in result) {
					logger.warn('[prerender]', `skipped ${route}: ${result.status}`)
					continue
				}

				const artifact = result.artifact

				if (artifact.mode === 'ppr') {
					const baseDir = Prerender.getArtifactPath(outDir, route)

					await fs.mkdir(baseDir, { recursive: true })

					const writes: Promise<number>[] = [
						Bun.write(path.join(baseDir, 'prelude.html'), artifact.html),
						Bun.write(
							path.join(baseDir, 'metadata.json'),
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
								path.join(baseDir, 'postponed.json'),
								JSON.stringify(artifact.postponed),
							),
						)
					}

					await Promise.all(writes)

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

				const outPath =
					route === '/'
						? path.join(outDir, 'index.html')
						: path.join(outDir, routeDir, 'index.html')

				await fs.mkdir(path.dirname(outPath), { recursive: true })
				await Bun.write(outPath, artifact.html)
				logger.info('[prerender]', `${route} (full)`)
			} catch (err) {
				logger.error(
					'[prerender]',
					`failed ${route}: ${err}. This often means unresolved async work (for example external fetches or dynamic rendering in full mode).`,
				)
			}
		}
	}

	// precompress
	if (manifest.precompress) {
		logger.info('[precompress]', 'compressing assets...')

		const buildContext = {
			outDir: manifest.outDir,
			bundle: {
				server: { entryPath: null, outDir: null },
				client: { entryPath: null, outDir: null },
			},
			transpiler: new Bun.Transpiler({ loader: 'tsx' }),
			prerenderedRoutes: new Set<string>(),
		}

		for await (const { input, compressed } of Compress.run(outDir, buildContext, {
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
	const outDir = path.resolve(cwd, 'dist')
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

	// import RSC server (handles prerendered HTML, static assets, and SSR).
	try {
		await fs.access(rscEntry)
	} catch {
		logger.error('[preview] missing dist/rsc/index.js - run `drift build` first')
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
			drift - metaframework cli

			Commands:
				build    Build for production (vite build + prerender + compress)
				dev      Start development server
				preview  Preview production build (serves prerendered HTML with SSR fallback)
		`)

		process.exit(command ? 1 : 0)
}
