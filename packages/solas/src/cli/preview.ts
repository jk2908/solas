import fs from 'node:fs/promises'
import path from 'node:path'

import { Logger } from '../utils/logger.js'

import { Solas } from '../solas.js'

const logger = new Logger()
const DEFAULT_PREVIEW_PORT = 4173
const [, , , ...args] = process.argv

export async function preview() {
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
	} catch (err) {
		logger.error(
			`[preview] missing ${path.relative(cwd, rscEntry)} - run \`${Solas.Config.SLUG} build\` from this project directory first`,
			err,
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
