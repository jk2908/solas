import type { BuildContext } from '../types'

/**
 * Check if a route is prerenderable
 * @param path - the path to the route
 * @param buildContext - the build context
 * @returns true if the route is prerenderable, false otherwise
 */
export async function isPrerenderable(path: string, buildContext: BuildContext) {
	try {
		const code = await Bun.file(path).text()
		const exports = buildContext.transpiler.scan(code).exports

		return exports.some(e => e === 'prerender')
	} catch (err) {
		buildContext.logger.error(`prerender:isPrerenderable ${path}`, err)
		return false
	}
}

/**
 * Get the list of prerenderable params for a route
 * @param path - the path to the route
 * @param buildContext - the build context
 * @returns the list of prerenderable params
 */
export async function getPrerenderParamsList(path: string, buildContext: BuildContext) {
	try {
		const mod = await import(path)

		if (!mod || !mod?.prerender || typeof mod.prerender !== 'function') {
			buildContext.logger.warn(
				'[prerender:getPrerenderParamsList]',
				`No exported prerender function found in ${path}`,
			)

			return []
		}

		return await Promise.resolve(mod.prerender())
	} catch (err) {
		buildContext.logger.error(`prerender:getPrerenderParamsList ${path}`, err)
		return []
	}
}

/**
 * Create prerender routes from a list of params
 * @param route - the route to create prerender routes from
 * @param list - the list of params to create prerender routes from
 * @returns the list of prerender routes
 */
export function createPrerenderRoutesFromParamsList(
	route: string,
	list: Record<string, string>[],
) {
	return list
		.map(list =>
			Object.entries(list).reduce(
				(acc, [key, value]) => acc.replace(`:${key}`, encodeURIComponent(String(value))),
				route,
			),
		)
		.filter(res => !res.includes(':'))
}

/**
 * Prerender a route
 * @param renderer - the renderer function to use
 * @param urls - the URLs to prerender
 * @param urls.route - the route to prerender
 * @param urls.app - the app URL to use as the base for relative routes
 * @param buildContext - the build context
 * @returns an async generator that yields the prerendered route
 * @throws if an error occurs during prerendering
 */
export async function* prerender(
	renderer: (req: Request) => Promise<Response>,
	target: string,
	base: string,
	buildContext?: BuildContext,
) {
	try {
		const url =
			target.startsWith('http://') || target.startsWith('https://')
				? new URL(target)
				: new URL(target, base)

		const req = new Request(url.toString(), {
			method: 'GET',
			headers: {
				Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
				Host: url.host,
				Origin: url.origin,
			},
		})

		const res = await renderer(req)

		if (!res.ok) throw new Error(`${target} returned ${res.status}`)

		let body = await res.text()
		const MARKER = '<!-- X-Drift-Renderer: prerender -->\n'

		if (
			String(res.headers.get('content-type') ?? '').includes('text/html') &&
			!body.startsWith(MARKER)
		) {
			body = MARKER + body
		}

		yield {
			route: target,
			status: res.status,
			headers: res.headers,
			body,
			res,
		}
	} catch (err) {
		buildContext?.logger.error(`[prerender*] ${target}`, err)
		throw err
	}
}
