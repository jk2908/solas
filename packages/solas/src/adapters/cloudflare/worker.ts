import type { Assets } from '../../internal/runtimes/assets.js'
import type { ImportMap, Manifest, RuntimeConfig } from '../../types.js'
import { createRuntimeHandler } from '../../internal/env/rsc.js'
import { nodeAssets } from '../../internal/runtimes/assets.js'
import { type CloudflareEnv, createCloudflareAssets } from './runtime.js'

export type CreateWorkerOptions = {
	config: RuntimeConfig
	manifest: Manifest
	importMap: ImportMap
}

type Handler = Awaited<ReturnType<typeof createRuntimeHandler>>

/**
 * Build a Cloudflare Worker around Solas's RSC handler.
 *
 * The asset store and handler depend on `env`, so handlers are cached per `env`
 * (not once per isolate). A failed build is evicted so a transient error does
 * not poison the Worker. During build-time prerender the Worker is invoked
 * without bindings, in which case the Node asset store is used.
 */
export function createWorker(options: CreateWorkerOptions) {
	const handlers = new WeakMap<object, Promise<Handler>>()
	let nodeHandler: Promise<Handler> | undefined

	async function build(assets: Assets) {
		return createRuntimeHandler(
			options.config,
			options.manifest,
			options.importMap,
			assets,
		)
	}

	function getHandler(env?: CloudflareEnv) {
		if (!env) {
			nodeHandler ??= build(nodeAssets).catch(err => {
				nodeHandler = undefined
				throw err
			})

			return nodeHandler
		}

		let promise = handlers.get(env)

		if (!promise) {
			promise = build(createCloudflareAssets(env)).catch(err => {
				handlers.delete(env)
				throw err
			})

			handlers.set(env, promise)
		}

		return promise
	}

	return {
		async fetch(request: Request, env?: CloudflareEnv, _ctx?: unknown) {
			const handler = await getHandler(env)

			return handler.fetch(request)
		},
	}
}
