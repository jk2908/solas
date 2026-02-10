#!/usr/bin/env bun
// Set production mode early
process.env.NODE_ENV = 'production'

import fs from 'node:fs/promises'
import path from 'node:path'

import type { BuildManifest } from './types'

import { Config } from './config'

import { Compress } from './utils/compress'
import { Logger } from './utils/logger'

const logger = new Logger()

async function build() {
	const cwd = process.cwd()
	const manifestPath = path.join(cwd, Config.GENERATED_DIR, 'build.json')

	// 1. Run vite build
	logger.info('[build]', 'running vite build...')
	const vite = Bun.spawnSync(['bunx', '--bun', 'vite', 'build', '--mode', 'production'], {
		cwd,
		stdout: 'inherit',
		stderr: 'inherit',
		env: { ...process.env, NODE_ENV: 'production' },
	})

	if (vite.exitCode !== 0) {
		logger.error('[build]', 'vite build failed')
		process.exit(1)
	}

	// 2. Read build manifest
	let manifest: BuildManifest
	try {
		const raw = await fs.readFile(manifestPath, 'utf-8')
		manifest = JSON.parse(raw)
	} catch {
		logger.error('[build]', 'failed to read build manifest')
		process.exit(1)
	}

	const outDir = path.resolve(cwd, manifest.outDir)
	const rscDir = path.join(outDir, 'rsc')

	// 3. Prerender routes
	if (manifest.prerenderableRoutes.length > 0) {
		logger.info('[prerender]', `prerendering ${manifest.prerenderableRoutes.length} routes...`)

		// Ensure production mode for React
		process.env.NODE_ENV = 'production'

		// Change to RSC dir so relative imports work
		const originalCwd = process.cwd()
		process.chdir(rscDir)

		try {
			const rscEntry = path.join(rscDir, 'index.js')
			const { default: app } = await import(/* @vite-ignore */ rscEntry)

			for (const route of manifest.prerenderableRoutes) {
				try {
					const url = `http://localhost${route}`
					const res = await app.fetch(new Request(url, { headers: { Accept: 'text/html' } }))

					if (!res.ok) {
						logger.warn('[prerender]', `skipped ${route}: ${res.status}`)
						continue
					}

					const html = await res.text()
					const outPath = route === '/' ? path.join(outDir, 'index.html') : path.join(outDir, route, 'index.html')

					await fs.mkdir(path.dirname(outPath), { recursive: true })
					await Bun.write(outPath, html)
					logger.info('[prerender]', route)
				} catch (err) {
					logger.error('[prerender]', `failed ${route}: ${err}`)
				}
			}
		} finally {
			process.chdir(originalCwd)
		}
	}

	// 4. Precompress
	if (manifest.precompress) {
		logger.info('[precompress]', 'compressing assets...')

		const buildContext = {
			outDir: manifest.outDir,
			bundle: { server: { entryPath: null, outDir: null }, client: { entryPath: null, outDir: null } },
			transpiler: new Bun.Transpiler({ loader: 'tsx' }),
			prerenderableRoutes: new Set<string>(),
		}

		for await (const { input, compressed } of Compress.run(outDir, buildContext, {
			filter: f => /\.(js|css|html|svg|json|txt)$/.test(f),
		})) {
			await Bun.write(`${input}.br`, compressed)
			logger.info('[precompress]', `${path.basename(input)}.br`)
		}
	}

	// 5. Cleanup
	await fs.unlink(manifestPath).catch(() => {})

	logger.info('[build]', 'done')
}

async function dev() {
	const proc = Bun.spawn(['bunx', '--bun', 'vite', 'dev'], {
		cwd: process.cwd(),
		stdout: 'inherit',
		stderr: 'inherit',
		stdin: 'inherit',
	})

	await proc.exited
}

async function preview() {
	const cwd = process.cwd()
	const outDir = path.resolve(cwd, 'dist')
	const rscDir = path.join(outDir, 'rsc')

	// Import RSC server (handles prerendered HTML, static assets, and SSR)
	process.chdir(rscDir)
	const rscEntry = path.join(rscDir, 'index.js')
	const { default: app } = await import(/* @vite-ignore */ rscEntry)
	process.chdir(cwd)

	const port = 4173

	Bun.serve({
		port,
		fetch: app.fetch,
	})

	logger.info('[preview]', `server running at http://localhost:${port}`)

	// Keep alive
	await new Promise(() => {})
}

// CLI
const [, , command] = process.argv

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
