import type { AssetNamespace, AssetRef, Assets } from '../../internal/runtimes/assets.js'
import { getMimeTypeFromPath } from '../../internal/runtimes/mime.js'

/**
 * The subset of the Cloudflare `assets` Fetcher binding that Solas needs.
 */
export type CloudflareAssets = {
	fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
}

/**
 * The bindings shape the Cloudflare asset store reads from.
 */
export type CloudflareEnv = {
	ASSETS?: CloudflareAssets
	[key: string]: unknown
}

/**
 * Path prefix the adapter copies `dist/.solas` artifacts under in the asset
 * output.
 */
export const ARTIFACT_PREFIX = '_solas-artifacts'

// The assets binding matches on pathname only, so this is only used to satisfy
// the URL constructor
const ASSET_ORIGIN = 'https://solas-assets.invalid'

/**
 * Where each namespace lives in the asset output, keyed by the shared
 * `AssetNamespace`. `client` files sit at the asset root; `static` (prerenders)
 * and `artifact` (manifest, ppr) live under the artifact prefix.
 *
 * Prerenders must not sit at their route paths: the asset layer ignores
 * `Accept`, so it would answer an RSC navigation (`Accept: text/x-component`)
 * with HTML instead of letting the Worker render it.
 */
export const NAMESPACE_PREFIX: Record<AssetNamespace, string> = {
	client: '',
	static: `${ARTIFACT_PREFIX}/static`,
	artifact: ARTIFACT_PREFIX,
}

/**
 * Create a Solas asset store backed by the Cloudflare assets binding.
 *
 * Workers have no writable filesystem, so this is read-only. `client` files are
 * served from the asset root; `static` and `artifact` files are served from the
 * adapter's artifact prefix.
 */
export function createCloudflareAssets(env: CloudflareEnv): Assets {
	const assets = env.ASSETS

	if (!assets || typeof assets.fetch !== 'function') {
		throw new Error(
			'[solas] createCloudflareAssets requires an `ASSETS` binding. Add an assets binding to your Worker.',
		)
	}

	// narrowed here, and `const` keeps that type inside the closures below
	const binding = assets

	function toUrl(asset: AssetRef) {
		const prefix = NAMESPACE_PREFIX[asset.namespace]
		const path = prefix ? `${prefix}/${asset.path}` : asset.path

		return new URL(`/${path}`, ASSET_ORIGIN).toString()
	}

	async function read(asset: AssetRef) {
		const res = await binding.fetch(toUrl(asset), {
			// asset responses should be passed through verbatim
			headers: { 'accept-encoding': 'identity' },
		})

		return res.ok ? res : null
	}

	async function readOrThrow(asset: AssetRef) {
		const res = await read(asset)

		if (!res) {
			throw new Error(`[solas] asset not found: ${asset.namespace}/${asset.path}`)
		}

		return res
	}

	return {
		async exists(asset) {
			return (await read(asset)) !== null
		},

		async readText(asset) {
			return (await readOrThrow(asset)).text()
		},

		async readBuffer(asset) {
			return (await readOrThrow(asset)).arrayBuffer()
		},

		mimeType(filePath) {
			return getMimeTypeFromPath(filePath)
		},
	}
}
