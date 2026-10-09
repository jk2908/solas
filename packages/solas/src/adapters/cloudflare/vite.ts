import fs from 'node:fs/promises'
import path from 'node:path'

import type { Plugin } from 'vite'

import { cloudflare as cloudflareVitePlugin } from '@cloudflare/vite-plugin'

import type { Adapter } from '../../types.js'
import * as Config from '../../config.js'
import { writeCloudflareEntry } from '../../internal/codegen/environments.js'
import { setRscEntry } from '../../internal/postbuild.js'
import { NAMESPACE_PREFIX } from './runtime.js'

/**
 * @see {@link https://developers.cloudflare.com/workers/vite-plugin/}
 */
type CloudflarePluginConfig = Parameters<typeof cloudflareVitePlugin>[0]
type WorkerConfigCustomizer = NonNullable<CloudflarePluginConfig>['config']

export type SolasCloudflareOptions = {
	/**
	 * Options forwarded to `@cloudflare/vite-plugin`.
	 */
	cloudflare?: CloudflarePluginConfig
}

const VIRTUAL_ENTRY = 'virtual:solas-cloudflare-entry'

/**
 * Solas dependencies that are imported at request time from the Worker
 * environment. They must be pre-bundled up front: the Cloudflare dev Worker
 * runs in workerd and does not survive a mid-request dependency
 * re-optimization, which otherwise leaves React split across two instances
 * ("Invalid hook call").
 */
const WORKER_OPTIMIZE_DEPS = ['path-to-regexp'] as const

async function pathExists(filePath: string) {
	try {
		await fs.access(filePath)
		return true
	} catch {
		return false
	}
}

/**
 * Recursively find directories named `assets` beneath Cloudflare's build output.
 */
async function findAssetDirs(root: string, found: string[] = []) {
	const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => [])

	for (const entry of entries) {
		if (!entry.isDirectory()) continue

		const full = path.join(root, entry.name)

		if (entry.name === 'assets') {
			found.push(full)
			continue
		}

		await findAssetDirs(full, found)
	}

	return found
}

/**
 * Copy Solas's output into every Cloudflare asset directory, all under the
 * artifact prefix so the asset layer never answers a document request itself:
 * - `dist/static/**` (full prerenders) at `<prefix>/static`, read back through
 *   the `ASSETS` binding so the Worker serves the HTML for `text/html` and
 *   renders RSC otherwise
 * - `dist/.solas/**` (runtime manifest + ppr artifacts) at `<prefix>`, read back
 *   through the `ASSETS` binding
 */
async function copyOutput(cwd: string) {
	const outDir = path.join(cwd, Config.OUT_DIR)
	const artifactSource = path.join(outDir, Config.GENERATED_DIR)
	const staticSource = path.join(outDir, 'static')

	const assetDirs = await findAssetDirs(path.join(cwd, '.cloudflare', 'output'))

	for (const assetDir of assetDirs) {
		if (await pathExists(artifactSource)) {
			await fs.cp(artifactSource, path.join(assetDir, NAMESPACE_PREFIX.artifact), {
				recursive: true,
				force: true,
			})
		}

		if (await pathExists(staticSource)) {
			await fs.cp(staticSource, path.join(assetDir, NAMESPACE_PREFIX.static), {
				recursive: true,
				force: true,
			})
		}
	}
}

/**
 * Merge the user's Worker config customiser with Solas's requirements:
 * the generated entrypoint and the `ASSETS` binding the runtime reads through.
 *
 * `htmlHandling: none` and `notFoundHandling: none` keep the asset layer from
 * answering document requests itself. Without this, a fully prerendered route
 * (say `/writing` backed by `writing.html`) is served by the asset layer for
 * *every* request to that path, so an RSC navigation (`Accept:
 * text/x-component`) receives HTML and the client fails to parse it. Routing
 * documents through the Worker lets Solas serve the prerender for `text/html`
 * and render RSC otherwise, while non-HTML assets still come straight from the
 * asset layer.
 */
type WorkerConfigCustomizerFn = Extract<
	WorkerConfigCustomizer,
	(...args: never[]) => unknown
>
type ParsedWorkerConfig = Parameters<WorkerConfigCustomizerFn>[0]

function withAdapterConfig(
	config: WorkerConfigCustomizer | undefined,
): WorkerConfigCustomizer {
	return (workerConfig: ParsedWorkerConfig) => {
		const base =
			typeof config === 'function' ? (config(workerConfig) ?? {}) : (config ?? {})

		return {
			...base,
			entrypoint: VIRTUAL_ENTRY,
			assets: { htmlHandling: 'none', notFoundHandling: 'none', ...base.assets },
			env: { ...base.env, ASSETS: { type: 'assets' } },
		}
	}
}

/**
 * Cloudflare adapter for Solas.
 *
 * Wraps `@cloudflare/vite-plugin`, generates the Worker entry that installs the
 * asset-backed store, points Solas's prerender step at the Cloudflare Worker
 * bundle, and copies prerender artifacts into the asset output.
 */
export function cloudflare(options: SolasCloudflareOptions = {}): Adapter {
	const cwd = process.cwd()
	// back the virtual entry id with a path inside the generated dir so the
	// generated entry's relative imports (`./manifest.js`, ...) resolve
	const virtualEntryPath = path.join(cwd, Config.GENERATED_DIR, 'entry.cloudflare.tsx')

	const cfPlugins = cloudflareVitePlugin({
		// Solas runs its server in the `rsc` environment; Cloudflare's worker
		// environment must match so the RSC runtime (and its `ssr` child) is
		// bundled into the Worker
		viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
		...options.cloudflare,
		config: withAdapterConfig(options.cloudflare?.config),
	})

	const adapter: Plugin = {
		name: 'solas-cloudflare',
		enforce: 'post',
		configResolved(config) {
			// the Cloudflare plugin points the `rsc` environment's build output at
			// the Worker bundle during its `config` hook, so by now we know where
			// Solas's prerender step should import the Worker from
			const rscOutDir = config.environments.rsc?.build.outDir

			if (rscOutDir) {
				setRscEntry(path.resolve(cwd, rscOutDir, 'index.js'))
			}
		},
		configEnvironment(name, environment) {
			// Pre-bundle the Worker environments so workerd never has to re-optimize
			// dependencies in the middle of a request. Scanning the app directory
			// surfaces any additional request-time dependencies too
			if (name !== 'rsc' && name !== 'ssr') return

			environment.optimizeDeps ??= {}
			environment.optimizeDeps.include = [
				...new Set([
					...(environment.optimizeDeps.include ?? []),
					...WORKER_OPTIMIZE_DEPS,
				]),
			]
			environment.optimizeDeps.entries = [
				...new Set([
					...(environment.optimizeDeps.entries ?? []),
					`${Config.APP_DIR}/**/*.{tsx,ts,jsx,js}`,
				]),
			]
		},
		resolveId(source) {
			return source === VIRTUAL_ENTRY ? virtualEntryPath : null
		},
		load(id) {
			return id === virtualEntryPath ? writeCloudflareEntry() : null
		},
		buildApp: {
			order: 'post',
			async handler() {
				// runs after Solas's own `post` buildApp (adapter comes later in the
				// plugin array), so `dist/.solas` artifacts already exist
				await copyOutput(cwd)
			},
		},
	}

	return { name: 'cloudflare', plugins: [adapter, ...cfPlugins] }
}
