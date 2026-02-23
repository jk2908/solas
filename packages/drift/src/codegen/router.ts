import type { Endpoint, Manifest, Segment } from '../types'

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
	const handlers = createHandlerGroups(manifest)
	const middlewareByPath = new Map(
		[...imports.middlewares.static.entries()].map(([id, path]) => [path, id]),
	)

	return `
    ${AUTOGEN_MSG}

    /// <reference types="bun" />

    import type { Server } from 'bun'

    import { Router } from '@jk2908/drift/server/router'

    import { handler as rsc } from './entry.rsc'
    import { config } from './config'

    ${[...imports.endpoints.static.entries()]
			.map(([key, value]) => {
				const [, method = 'get'] = key.split('_')
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
        ${[...handlers.entries()]
					.map(([, group]) => {
						if (!Array.isArray(group)) {
							const method = group.method.toUpperCase()
							const params = JSON.stringify(group.__params ?? [])
							const middlewareIds =
								group.__kind === Build.EntryKind.PAGE
									? ((group as Segment).paths.middlewares ?? [])
									: ((group as Endpoint).middlewares ?? [])
							const middleware = middlewareIds
								.map((id: string | null) =>
									id ? (middlewareByPath.get(id) ?? null) : null,
								)
								.filter(Boolean)
							const middlewareArg = middleware.length
								? `[${middleware.join(', ')}]`
								: '[]'

							return group.__kind === Build.EntryKind.PAGE
								? `.add('${group.__path}', '${method}', req => rsc(req), ${params}, ${middlewareArg})`
								: `.add('${group.__path}', '${method}', req => ${group.__id}(req), ${params}, ${middlewareArg})`
						}

						if (group.length > 2) throw new Error('Unexpected group length')

						const id = group.find(e => e.__kind === Build.EntryKind.ENDPOINT)?.__id
						const path = group[0].__path
						const params = JSON.stringify(group[0].__params ?? [])
						const middlewareIds =
							(
								group.find(entry => entry.__kind === Build.EntryKind.PAGE) as
									| Segment
									| undefined
							)?.paths.middlewares ??
							(group[0] as Endpoint).middlewares ??
							[]
						const middleware = middlewareIds
							.map((id: string | null) =>
								id ? (middlewareByPath.get(id) ?? null) : null,
							)
							.filter(Boolean)
						const middlewareArg = middleware.length ? `[${middleware.join(', ')}]` : '[]'

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
					}, ${params}, ${middlewareArg})`
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
