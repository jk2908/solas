import type { PrerenderImport } from '../../internal/postbuild.js'

/** The shim module `cloudflare:workers` resolves to during the prerender. */
const WORKERS_SHIM = new URL('./workers-shim.js', import.meta.url).href

/**
 * Wrap the prerender import so `cloudflare:workers` resolves to a local shim
 * while the server bundle loads. The bundle on disk keeps the real import; this
 * only affects the Node import Solas makes to prerender.
 */
export function withBindingsShim(next: PrerenderImport): PrerenderImport {
	return async () => {
		const { registerHooks } = await import('node:module')

		const hooks = registerHooks({
			resolve(specifier, context, nextResolve) {
				if (specifier === 'cloudflare:workers') {
					return { url: WORKERS_SHIM, shortCircuit: true }
				}

				return nextResolve(specifier, context)
			},
		})

		try {
			return await next()
		} finally {
			hooks.deregister()
		}
	}
}
