import type { Endpoint, Manifest, Segment } from '../types'

import { Config } from '../_shared/config'

import { Build } from '../build'

import { AUTOGEN_MSG } from './utils'

/**
 * Generates the exported server-side code for creating the router
 * with all the routes and handlers defined in the manifest
 * @param manifest - the application manifest
 * @param imports - the imported modules
 * @returns the stringified code
 */
export function writeRouter(manifest: Manifest, imports: Build.Imports) {
	// group manifest entries by method and path
	const groups = createHandlerGroups(manifest)

	// map middleware file path -> import id
	const mwByPath = new Map(
		[...imports.middlewares.static.entries()].map(([id, path]) => [path, id]),
	)

	return `
    ${AUTOGEN_MSG}

    /// <reference types="bun" />

    import type { Server } from 'bun'

    import { Router } from '${Config.PKG_NAME}/router'

    import { handler as rsc } from './entry.rsc'
    import { config } from './config'

		${[...imports.endpoints.static.entries()]
			.map(([key, value]) => {
				// key format is name_method
				const [, method] = key.split('_')
				return `import { ${method.toUpperCase()} as ${key} } from ${JSON.stringify(value)}`
			})
			.join('\n')}


		${[...imports.middlewares.static.entries()]
			.map(
				([key, value]) => `import { middleware as ${key} } from ${JSON.stringify(value)}`,
			)
			.join('\n')}

    export function createRouter() {
      return new Router({
        trailingSlash: config.trailingSlash,
      })
        .add('/assets/*', 'GET', Router.serveStatic(config))
        ${[...groups.entries()]
					.map(([, group]) => {
						if (!Array.isArray(group)) {
							const method = group.method.toUpperCase()

							// serialise path params for router registration
							const params = JSON.stringify(group.__params ?? [])

							// resolve any middlewares for this route
							const mw = (
								group.__kind === Build.EntryKind.PAGE
									? (group.paths.middlewares ?? [])
									: (group.middlewares ?? [])
							)
								.map((id: string | null) => (id ? (mwByPath.get(id) ?? null) : null))
								.filter(Boolean)

							// create stringified middleware arg
							const mwArg = mw.length ? `[${mw.join(', ')}]` : '[]'

							return group.__kind === Build.EntryKind.PAGE
								? `.add('${group.__path}', '${method}', req => rsc(req), ${params}, ${mwArg})`
								: `.add('${group.__path}', '${method}', req => ${group.__id}(req), ${params}, ${mwArg})`
						}

						// unified handler: page + endpoint pair only
						if (group.length > 2) throw new Error('Unexpected group length')

						const id = group.find(e => e.__kind === Build.EntryKind.ENDPOINT)?.__id
						const path = group[0].__path

						// serialise path params for router registration
						const params = JSON.stringify(group[0].__params ?? [])

						// resolve any middlewares from page or endpoint
						const mw = (
							group.find(entry => entry.__kind === Build.EntryKind.PAGE)?.paths
								.middlewares ??
							(group[0] as Endpoint).middlewares ??
							[]
						)
							.map(id => (id ? (mwByPath.get(id) ?? null) : null))
							.filter(Boolean)

						const mwArg = mw.length ? `[${mw.join(', ')}]` : '[]'

						return `.add('${path}', 'GET', async req => {
			      const accept = req.headers.get('accept') ?? ''

						if (accept.includes('text/html') || accept.includes('text/x-component')) {
							return rsc(req)
						}

						if (!${id}) {
							throw new Error('Unified handler missing implementation')
						}

						// @ts-ignore
						return ${id}(req)
					}, ${params}, ${mwArg})`
					})
					.join('\n      ')}
        .error((err, req) => rsc(req, err))
    }

    export type App = Server<ReturnType<typeof createRouter>>
  `.trim()
}

function createHandlerGroups(manifest: Manifest) {
	return Object.values(manifest)
		.flat()
		.reduce<Map<string, Segment | Endpoint | (Segment | Endpoint)[]>>((acc, entry) => {
			// group by method + path to unify page/endpoint pairs
			const key = `${entry.method}/${entry.__path}`
			const existing = acc.get(key)

			if (!existing) {
				// first handler for this route
				acc.set(key, entry)
			} else if (Array.isArray(existing)) {
				// add to existing group
				existing.push(entry)
			} else {
				// promote to a grouped array
				acc.set(key, [existing, entry])
			}

			return acc
		}, new Map())
}
