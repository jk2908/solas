import type {
	DriftRequest,
	Endpoint,
	ImportMap,
	Manifest,
	ManifestEntry,
	PluginConfig,
	Segment,
} from '../../types'

import { Router } from './router'

type RouteGroup = Segment | Endpoint | [ManifestEntry, ...ManifestEntry[]]

function callEndpoint(
	fn: (...args: [] | [Request]) => Response | Promise<Response>,
	req: Request,
) {
	// endpoint modules may export either a zero-arg handler or one that expects the request
	if (fn.length === 0) return fn()
	return fn(req)
}

function createHandlerGroups(manifest: Manifest) {
	return Object.values(manifest)
		.flat()
		.reduce<Map<string, RouteGroup>>((acc, entry) => {
			// group by method + path so page and endpoint pairs can share one GET handler
			const key = `${entry.method}/${entry.__path}`
			const existing = acc.get(key)

			if (!existing) {
				acc.set(key, entry)
			} else if (Array.isArray(existing)) {
				existing.push(entry)
			} else {
				acc.set(key, [existing, entry])
			}

			return acc
		}, new Map())
}

function resolveMiddlewares(entry: ManifestEntry, importMap: ImportMap) {
	// the manifest keeps middleware paths for serialisable route data, while the
	// import map carries the actual runtime middleware functions
	const middlewares = importMap[entry.__id]?.middlewares ?? []

	return middlewares.filter(
		(value): value is NonNullable<(typeof middlewares)[number]> => value !== null,
	)
}

function mergeMiddlewares(
	left: readonly (Router.Middleware | null)[] | undefined,
	right: readonly (Router.Middleware | null)[] | undefined,
) {
	const merged: Router.Middleware[] = []

	// unified page plus endpoint routes need one middleware chain, preserving the
	// declared order but dropping duplicate functions shared by both sides
	for (const middleware of [...(left ?? []), ...(right ?? [])]) {
		if (!middleware) continue
		if (merged.includes(middleware)) continue

		merged.push(middleware)
	}

	return merged
}

/**
 * Create the application router from the generated manifest and import map
 */
export function createRouter(
	config: Pick<PluginConfig, 'outDir' | 'precompress' | 'trailingSlash'>,
	manifest: Manifest,
	importMap: ImportMap,
	rsc: (req: DriftRequest) => Response | Promise<Response>,
) {
	const router = new Router({
		trailingSlash: config.trailingSlash,
	})

	// static assets stay outside route middleware conventions and are registered once
	router.add('/assets/*', 'GET', Router.static(config))

	for (const [, group] of createHandlerGroups(manifest)) {
		if (!Array.isArray(group)) {
			if ('paths' in group) {
				// plain page routes always hand off to the RSC request pipeline
				router.add(
					group.__path,
					group.method.toUpperCase(),
					req => rsc(req),
					group.__params,
					resolveMiddlewares(group, importMap),
				)
				continue
			}

			const endpoint = importMap[group.__id]?.endpoint
			if (!endpoint) {
				throw new Error(`Missing endpoint handler for ${group.__id}`)
			}

			// standalone endpoints resolve directly from the import map and bypass RSC
			router.add(
				group.__path,
				group.method.toUpperCase(),
				req =>
					callEndpoint(endpoint as (req?: Request) => Response | Promise<Response>, req),
				group.__params,
				resolveMiddlewares(group, importMap),
			)
			continue
		}

		if (group.length > 2) throw new Error('Unexpected route group length')

		const page = group.find((entry): entry is Segment => 'paths' in entry)
		const endpointEntry = group.find((entry): entry is Endpoint => !('paths' in entry))

		if (!page) {
			throw new Error('Unified route group missing page entry')
		}

		const endpoint = endpointEntry ? importMap[endpointEntry.__id]?.endpoint : undefined
		// page plus endpoint pairs share one GET registration that chooses between
		// document or RSC rendering and the endpoint implementation at request time
		const middlewares = mergeMiddlewares(
			importMap[page.__id]?.middlewares,
			endpointEntry ? importMap[endpointEntry.__id]?.middlewares : undefined,
		)

		router.add(
			page.__path,
			'GET',
			async req => {
				const accept = req.headers.get('accept') ?? ''

				if (accept.includes('text/html') || accept.includes('text/x-component')) {
					return rsc(req)
				}

				if (!endpoint) {
					throw new Error(`Missing unified endpoint handler for ${page.__path}`)
				}

				return callEndpoint(
					endpoint as (req?: Request) => Response | Promise<Response>,
					req,
				)
			},
			page.__params,
			middlewares,
		)
	}

	// the router already stores the thrown error on the request metadata before
	// invoking the error hook, so the RSC pipeline can read it back from req
	return router.error((_err, req) => rsc(req))
}
