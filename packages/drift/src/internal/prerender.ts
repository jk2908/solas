import path from 'node:path'

import type { BuildContext } from '../types'

export namespace Prerender {
	/**
	 * Check if a file exports a prerender flag (boolean),
	 * indicating it wants to be prerendered
	 * @param filePath - file path to check
	 * @param buildContext - build context
	 * @returns true/false when explicitly exported, undefined otherwise
	 */
	export async function getStaticFlag(filePath: string, buildContext: BuildContext) {
		const code = await Bun.file(filePath).text()
		const exports = buildContext.transpiler.scan(code).exports

		if (!exports.includes('prerender')) return 

		const abs = path.resolve(process.cwd(), filePath)
		const mod = await import(/* @vite-ignore */ abs)

		if (mod.prerender === true) return true
		if (mod.prerender === false) return false

		return 
	}

	/**
	 * Get static params from prerender function export
	 * @param filePath - file path to check
	 * @param buildContext - build context
	 * @returns params array or empty array if no prerender export
	 * or prerender is not a function
	 */
	export async function getStaticParams(filePath: string, buildContext: BuildContext) {
		const code = await Bun.file(filePath).text()
		const exports = buildContext.transpiler.scan(code).exports

		if (!exports.includes('prerender')) return []

		const abs = path.resolve(process.cwd(), filePath)
		const mod = await import(/* @vite-ignore */ abs)

		if (typeof mod.prerender !== 'function') return []
		return Promise.try(() => mod.prerender())
	}

	/**
	 * Expand a dynamic route with params into concrete paths
	 * @param route - route pattern like /posts/:id
	 * @param params - array of param objects
	 * @returns expanded routes
	 */
	export function getDynamicRouteList(
		route: string,
		params: Record<string, string | number>[],
	) {
		if (!params.length) return []

		return params
			.map(p =>
				Object.entries(p).reduce(
					(acc, [key, value]) =>
						acc.replace(`:${key}`, encodeURIComponent(String(value))),
					route,
				),
			)
			.filter(r => !r.includes(':') && !r.includes('*'))
	}
}
