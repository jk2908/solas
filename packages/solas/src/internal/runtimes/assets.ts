import fs from 'node:fs/promises'
import path from 'node:path'

import * as Config from '../../config.js'
import { getMimeTypeFromPath } from './mime.js'

/**
 * The three kinds of output Solas reads at request time:
 * - `client`: Vite's client build output and public files (`dist/client`)
 * - `static`: fully prerendered routes (`dist/static`, route-shaped files)
 * - `artifact`: the runtime manifest and PPR artifacts (`dist/.solas`)
 */
export type AssetNamespace = 'client' | 'static' | 'artifact'

/**
 * A logical reference to an output file. Adapters map namespaces onto their own
 * storage (the Node store onto directories, the Cloudflare store onto asset URLs)
 * so callers never pass platform- or filesystem-specific paths.
 */
export type AssetRef = {
	namespace: AssetNamespace
	path: string
}

/**
 * Read-only access to the static output Solas serves at request time.
 *
 * Platforms without a filesystem provide their own implementation (for example
 * the Cloudflare adapter reads through the `ASSETS` binding). Build-time writes
 * do not go through this interface — the build always runs in Node/Bun and uses
 * `node:fs` directly.
 */
export interface Assets {
	exists: (asset: AssetRef) => Promise<boolean>
	readText: (asset: AssetRef) => Promise<string>
	readBuffer: (asset: AssetRef) => Promise<ArrayBuffer>
	mimeType: (filePath: string) => string
}

const NAMESPACE_DIRS: Record<AssetNamespace, string> = {
	client: 'client',
	static: 'static',
	artifact: Config.GENERATED_DIR,
}

function resolvePath(asset: AssetRef) {
	return path.resolve(Config.OUT_DIR, NAMESPACE_DIRS[asset.namespace], asset.path)
}

/**
 * The default asset store, backed by the Node standard library (which Bun runs
 * natively).
 */
export const nodeAssets: Assets = {
	async exists(asset) {
		try {
			await fs.access(resolvePath(asset))
			return true
		} catch {
			return false
		}
	},

	readText(asset) {
		return fs.readFile(resolvePath(asset), 'utf-8')
	},

	async readBuffer(asset) {
		const buffer = await fs.readFile(resolvePath(asset))

		return buffer.buffer.slice(
			buffer.byteOffset,
			buffer.byteOffset + buffer.byteLength,
		) as ArrayBuffer
	},

	mimeType(filePath) {
		return getMimeTypeFromPath(filePath)
	},
}
