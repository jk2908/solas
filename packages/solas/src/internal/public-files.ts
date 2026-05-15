import { promises as fs } from 'node:fs'
import path from 'node:path'

import { Solas } from '../solas.js'

/**
 * Collect the root request paths for files that originate in Vite's public dir.
 * Vite copies these files into the built client output unchanged. Solas stores
 * the request paths here so runtime serving can whitelist them
 *
 * @example
 * ```ts
 * // public/robots.txt
 * // becomes '/robots.txt'
 * ```
 *
 * @example
 * ```ts
 * // public/images/logo 1.png
 * // becomes '/images/logo%201.png'
 * ```
 */
export async function collect(root: string | false | null | undefined) {
	if (!root) return []

	// normalise the configured public dir before we start walking it
	const publicRoot = path.resolve(root)

	try {
		const stat = await fs.stat(publicRoot)
		if (!stat.isDirectory()) return []
	} catch {
		return []
	}

	const files: string[] = []

	async function walk(dir: string, parts: string[] = []) {
		const entries = await fs.readdir(dir, { withFileTypes: true })

		for (const entry of entries) {
			// top-level /public/_solas would collide with framework assets served
			// from /_solas, so keep that namespace reserved
			if (
				parts.length === 0 &&
				entry.isDirectory() &&
				entry.name === Solas.Config.ASSETS_DIR
			) {
				continue
			}

			const nextParts = [...parts, entry.name]
			const nextPath = path.join(dir, entry.name)

			if (entry.isDirectory()) {
				await walk(nextPath, nextParts)
				continue
			}

			if (!entry.isFile()) continue

			// store the external request path, not the filesystem path
			// eg public/favicon.ico -> /favicon.ico
			// eg public/images/logo 1.png -> /images/logo%201.png
			// encode each segment so manifest lookups match routed URLs
			files.push(`/${nextParts.map(part => encodeURIComponent(part)).join('/')}`)
		}
	}

	await walk(publicRoot)

	// keep manifest output stable regardless of directory iteration order
	return files.sort()
}
