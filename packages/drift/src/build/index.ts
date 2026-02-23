import type { Dirent } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

import type { BuildContext, Endpoint, HttpMethod, PluginConfig, Segment } from '../types'

import { Config } from '../config'

import {
	createPrerenderRoutesFromParamsList,
	getPrerenderParamsList,
	isPrerenderable,
} from '../server/prerender'

export namespace Build {
	export type ScanResult = {
		segments: {
			// directory path that defines this segment
			dir: string
			// optional page file at this segment
			page?: string
			// layout chain from shell to this segment
			layouts: (string | null)[]
			// shell (root layout)
			shell: string
			// 404 boundary chain
			'404s': (string | null)[]
			// loading component chain
			loaders: (string | null)[]
			// middleware chain
			middlewares: (string | null)[]
		}[]
		endpoints: { file: string; middlewares: (string | null)[] }[]
	}

	export type Imports = {
		endpoints: { static: Map<string, string> }
		components: { static: Map<string, string>; dynamic: Map<string, string> }
		middlewares: { static: Map<string, string> }
	}

	export type Modules = Record<
		string,
		{
			shellId?: string
			layoutIds?: (string | null)[]
			pageId?: string
			'404Ids'?: (string | null)[]
			loadingIds?: (string | null)[]
			middlewareIds?: (string | null)[]
			endpointId?: string
		}
	>

	const HTTP_VERBS = ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'] as const

	export const EntryKind = {
		SHELL: '$S',
		LAYOUT: '$L',
		PAGE: '$P',
		404: '$404',
		LOADING: '$LOAD',
		MIDDLEWARE: '$MW',
		ENDPOINT: '$E',
	} as const

	/**
	 * RouteProcessor class to process application routes
	 */
	export class RouteProcessor {
		constructor(
			public readonly buildContext: BuildContext,
			public readonly config: PluginConfig,
		) {}

		/**
		 * Extracts dynamic parameter names from a file path
		 * @param file - the file path to extract parameters from
		 * @returns an array of parameter names
		 */
		static getParams(file: string) {
			return Array.from(file.matchAll(/\[(?:\.\.\.)?([^\]]+)\]/g), m => m[1])
		}

		/**
		 * Get the depth of a route based on slashes
		 * @param route - the route to get the depth of
		 * @returns the depth of the route
		 */
		static getDepth(route: string) {
			if (route === '/') return 0

			// count slashes to determine depth
			return route.split('/').length - 1
		}

		/**
		 * Convert a file path to a canonical route.
		 * @param file - the file to convert to a route
		 * @returns the converted route
		 */
		static toCanonicalRoute(file: string) {
			const route = file
				.replace(new RegExp(`^${Config.APP_DIR}`), '')
				.replace(/\/\+page\.(j|t)sx?$/, '')
				.replace(/\/\+endpoint\.(j|t)sx?$/, '')
				.replace(/\[\.\.\..+?\]/g, '*') // catch-all routes
				.replace(/\[(.+?)\]/g, ':$1') // dynamic routes

			if (!route || route === '') return '/'

			return route.startsWith('/') ? route : `/${route}`
		}

		/**
		 * Get the import path for a file
		 * This finds the relative path from the generated
		 * directory to the file, removes the extension and
		 * replaces backslashes with forward slashes.
		 * @param file the file to get the import path for
		 * @returns the import path for the file
		 */
		static getImportPath(file: string) {
			const cwd = process.cwd()
			const generatedDir = path.join(cwd, Config.GENERATED_DIR)

			return path
				.relative(generatedDir, path.resolve(cwd, file))
				.replace(/\\/g, '/')
				.replace(/\.(t|j)sx?$/, '')
		}

		/**
		 * Run the RouteProcessor to get the app route and associated data
		 * needed for codegen
		 * @returns data needed for codegen
		 * @returns data.entries - the full list of entries for the manifest
		 * @returns data.imports - the dynamic and static imports for page and API routes
		 * @returns data.handlers - the Hono route handlers
		 * @returns data.prerenderableRoutes - the prerenderable routes
		 * @throws if an error occurs during scanning
		 */
		async run() {
			try {
				return await this.process(await this.#scan(Config.APP_DIR))
			} catch (err) {
				this.buildContext?.logger.error('[run]: failed to build manifest', err)
				throw err
			}
		}

		/**
		 * Scan the filesystem to get all routes for processing
		 * @param dir - the directory to scan
		 * @param res - the result object to populate
		 * @param prev - the previous layout, error and loading results
		 * @returns a result object containing segments and API routes
		 */
		async #scan(
			dir: string,
			res: ScanResult = { segments: [], endpoints: [] },
			prev: {
				layouts: (string | null)[]
				'404s': (string | null)[]
				loaders: (string | null)[]
				middlewares: (string | null)[]
			} = {
				layouts: [],
				'404s': [],
				loaders: [],
				middlewares: [],
			},
		) {
			try {
				// define valid route files
				const EXTENSIONS = {
					page: ['tsx', 'jsx'],
					api: ['ts', 'js'],
				} as const

				// define route file types
				const TYPES = {
					page: '+page',
					'404': '+404',
					layout: '+layout',
					loading: '+loading',
					middleware: '+middleware',
					endpoint: '+endpoint',
				} as const

				// map of valid files for each type
				const validFiles = {
					[TYPES.page]: new Set(EXTENSIONS.page.map(ext => `${TYPES.page}.${ext}`)),
					[TYPES['404']]: new Set(EXTENSIONS.page.map(ext => `${TYPES['404']}.${ext}`)),
					[TYPES.loading]: new Set(EXTENSIONS.page.map(ext => `${TYPES.loading}.${ext}`)),
					[TYPES.layout]: new Set(EXTENSIONS.page.map(ext => `${TYPES.layout}.${ext}`)),
					[TYPES.middleware]: new Set(
						EXTENSIONS.api.map(ext => `${TYPES.middleware}.${ext}`),
					),
					[TYPES.endpoint]: new Set(
						EXTENSIONS.api.map(ext => `${TYPES.endpoint}.${ext}`),
					),
				}

				const files = await fs.readdir(dir, { withFileTypes: true })

				// keep a predictable order so layout/loading are picked
				// up before page. Avoids OS dir ordering causing pages
				// to steal layout/loaders first and drop alignment
				files.sort((a, b) => {
					if (a.isFile() && b.isDirectory()) return -1
					if (a.isDirectory() && b.isFile()) return 1

					if (a.isFile() && b.isFile()) {
						const priority = (d: Dirent) => {
							const base = path.basename(d.name)

							if (validFiles[TYPES.layout].has(base)) return 0
							if (validFiles[TYPES['404']].has(base)) return 1
							if (validFiles[TYPES.loading].has(base)) return 2
							if (validFiles[TYPES.middleware].has(base)) return 3
							if (validFiles[TYPES.page].has(base)) return 4
							if (validFiles[TYPES.endpoint].has(base)) return 5

							return 5
						}

						return priority(a) - priority(b)
					}

					return 0
				})

				// current layout, 404, loader, middleware, and page files for this segment
				let currentLayout: string | undefined
				let current404: string | undefined
				let currentLoader: string | undefined
				let currentMiddleware: string | undefined
				let currentPage: string | undefined

				for (const file of files) {
					const route = path.join(dir, file.name)

					if (file.isDirectory()) {
						// before recursing, create segment for current dir if it
						// has a layout (defines a wrapper for child routes)
						if (!currentPage && currentLayout) {
							const layouts = [...prev.layouts, currentLayout]
							const notFounds = [...prev['404s'], current404 ?? null]
							const loaders = [...prev.loaders, currentLoader ?? null]
							const middlewares = [...prev.middlewares, currentMiddleware ?? null]
							const shell = layouts[0]

							if (shell) {
								res.segments.push({
									dir,
									page: undefined,
									'404s': notFounds,
									loaders,
									middlewares,
									layouts: layouts.length > 1 ? layouts.slice(1) : [],
									shell,
								})
							}
						}

						const next = {
							layouts: [...prev.layouts, currentLayout ?? null],
							'404s': [...prev['404s'], current404 ?? null],
							loaders: [...prev.loaders, currentLoader ?? null],
							middlewares: [...prev.middlewares, currentMiddleware ?? null],
						}

						await this.#scan(route, res, next)
					} else {
						const base = path.basename(file.name)
						const relative = path.relative(process.cwd(), route).replace(/\\/g, '/')

						if (validFiles[TYPES.layout].has(base)) {
							currentLayout = relative
						} else if (validFiles[TYPES['404']].has(base)) {
							current404 = relative
						} else if (validFiles[TYPES.loading].has(base)) {
							currentLoader = relative
						} else if (validFiles[TYPES.middleware].has(base)) {
							currentMiddleware = relative
						} else if (validFiles[TYPES.endpoint].has(base)) {
							res.endpoints.push({
								file: relative,
								middlewares: [...prev.middlewares, currentMiddleware ?? null],
							})
						} else if (validFiles[TYPES.page].has(base)) {
							currentPage = relative
							const layouts = [...prev.layouts, currentLayout ?? null]
							const notFounds = [...prev['404s'], current404 ?? null]
							const loaders = [...prev.loaders, currentLoader ?? null]
							const middlewares = [...prev.middlewares, currentMiddleware ?? null]
							const shell = layouts?.[0]

							if (!shell) throw new Error('Missing app shell')

							res.segments.push({
								dir,
								page: relative,
								'404s': notFounds,
								loaders,
								middlewares,
								layouts: layouts.length > 1 ? layouts.slice(1) : [],
								shell,
							})
						}
					}
				}

				// warn if segment has 404/loading but no page or layout
				if (!currentPage && !currentLayout && (current404 || currentLoader)) {
					this.buildContext?.logger.warn(
						`[#scan]: ${dir} has +error or +loading but no +page or +layout. This path will not be routable (404), but these files will still be inherited by child routes`,
					)
				}

				// create segment if we have a layout but no page and
				// haven't created one yet (no subdirectories triggered it)
				if (!currentPage && currentLayout && !res.segments.some(s => s.dir === dir)) {
					const layouts = [...prev.layouts, currentLayout]
					const notFounds = [...prev['404s'], current404 ?? null]
					const loaders = [...prev.loaders, currentLoader ?? null]
					const middlewares = [...prev.middlewares, currentMiddleware ?? null]
					const shell = layouts[0]

					if (shell) {
						res.segments.push({
							dir,
							page: undefined,
							'404s': notFounds,
							loaders,
							middlewares,
							layouts: layouts.length > 1 ? layouts.slice(1) : [],
							shell,
						})
					}
				}

				return res satisfies ScanResult
			} catch (err) {
				this.buildContext?.logger.error(
					`[#scan]: Failed to compose manifest from ${dir}`,
					err,
				)

				return {
					segments: [],
					endpoints: [],
				} satisfies ScanResult
			}
		}

		/**
		 * Process the scanned route data
		 * @param res the scanned route data
		 * @returns an object containing finalised manifest, imports, and prerenderable routes
		 */
		async process(res: ScanResult) {
			const processed = new Set<string>()
			const prerenderableRoutes = new Set<string>()

			const manifest: Record<string, Segment | Endpoint | (Segment | Endpoint)[]> = {}

			// imports for endpoints and components
			const imports: Imports = {
				endpoints: { static: new Map() },
				components: { static: new Map(), dynamic: new Map() },
				middlewares: { static: new Map() },
			}

			const modules: Modules = {}
			const prerenderableCache = new Map<string, boolean>()

			for (const segment of res.segments) {
				try {
					if (!this.buildContext || !this.config) continue

					const {
						shell,
						layouts,
						page,
						'404s': notFounds,
						loaders,
						middlewares,
						dir,
					} = segment

					// route is derived from dir path, not page
					const route = RouteProcessor.toCanonicalRoute(
						page ?? `${dir.replace(/\\/g, '/')}/+page.tsx`,
					)
					const params = RouteProcessor.getParams(dir)
					const depth = RouteProcessor.getDepth(route)

					const isDynamic = route.includes(':')
					const isCatchAll = route.includes('*')

					// track if any parent is prerenderable
					let hasInheritedPrerender = false

					const shellImport = RouteProcessor.getImportPath(shell)

					const shellId = `${EntryKind.SHELL}${Bun.hash(shellImport)}`
					const layoutIds: (string | null)[] = []
					const notFoundIds: (string | null)[] = []
					const loadingIds: (string | null)[] = []
					const middlewareIds: (string | null)[] = []

					// if shell not processed yet
					if (!processed.has(shell)) {
						let cached = prerenderableCache.get(shell)

						if (cached === undefined) {
							cached = await isPrerenderable(shell, this.buildContext)
							prerenderableCache.set(shell, cached)
						}

						hasInheritedPrerender = cached

						imports.components.static.set(shellId, shellImport)
						processed.add(shell)
					} else {
						hasInheritedPrerender =
							hasInheritedPrerender || (prerenderableCache.get(shell) ?? false)
					}

					for (const layout of layouts) {
						if (!layout) {
							layoutIds.push(null)
							continue
						}

						const layoutImport = RouteProcessor.getImportPath(layout)
						const layoutId = `${EntryKind.LAYOUT}${Bun.hash(layoutImport)}`

						let cached = prerenderableCache.get(layout)

						if (cached === undefined) {
							cached = await isPrerenderable(layout, this.buildContext)
							prerenderableCache.set(layout, cached)
						}

						hasInheritedPrerender ||= cached
						// always record chain. Only imports are deduped
						layoutIds.push(layoutId)

						// avoid re-importing seen layouts
						if (!processed.has(layout)) {
							imports.components.dynamic.set(layoutId, layoutImport)
							processed.add(layout)
						}
					}

					for (const notFound of notFounds) {
						// hole if level does not declare a 404 boundary.
						// Keep slot so indices match layouts
						if (!notFound) {
							notFoundIds.push(null)
							continue
						}

						const notFoundImport = RouteProcessor.getImportPath(notFound)
						const notFoundId = `${EntryKind['404']}${Bun.hash(notFoundImport)}`

						notFoundIds.push(notFoundId)

						// dedupe imports but still assign the slot for this route
						if (!processed.has(notFound)) {
							imports.components.dynamic.set(notFoundId, notFoundImport)
							processed.add(notFound)
						}
					}

					for (const loader of loaders) {
						// hole if level does not declare a loader.
						// Keep slot so indices match layouts
						if (!loader) {
							loadingIds.push(null)
							continue
						}

						const loaderImport = RouteProcessor.getImportPath(loader)
						const loaderId = `${EntryKind.LOADING}${Bun.hash(loaderImport)}`

						loadingIds.push(loaderId)

						// dedupe imports but still assign the slot for this route
						if (!processed.has(loader)) {
							imports.components.dynamic.set(loaderId, loaderImport)
							processed.add(loader)
						}
					}

					for (const middleware of middlewares) {
						if (!middleware) {
							middlewareIds.push(null)
							continue
						}

						const middlewareImport = RouteProcessor.getImportPath(middleware)
						const middlewareId = `${EntryKind.MIDDLEWARE}${Bun.hash(middlewareImport)}`

						middlewareIds.push(middlewareId)

						if (!processed.has(middleware)) {
							const code = await Bun.file(middleware).text()
							const exports = this.buildContext.transpiler.scan(code).exports

							if (!exports.includes('middleware')) {
								this.buildContext?.logger.warn(
									'[process]',
									`Missing export 'middleware' in ${middleware}`,
								)
							}

							imports.middlewares.static.set(middlewareId, middlewareImport)
							processed.add(middleware)
						}
					}

					// generate entry ID based on page if exists, otherwise dir
					const entryId = page
						? `${EntryKind.PAGE}${Bun.hash(RouteProcessor.getImportPath(page))}`
						: `${EntryKind.PAGE}${Bun.hash(route)}`

					let shouldPrerender = false

					if (page) {
						const pageImport = RouteProcessor.getImportPath(page)

						shouldPrerender =
							hasInheritedPrerender ||
							this.config?.prerender === 'full' ||
							(await isPrerenderable(page, this.buildContext))

						if (shouldPrerender) {
							if (!isDynamic && !isCatchAll) {
								prerenderableRoutes.add(route)
							} else {
								const paramsList = await getPrerenderParamsList(
									path.resolve(process.cwd(), page),
									this.buildContext,
								)

								if (!paramsList?.length) {
									this.buildContext?.logger.warn(
										'[process]',
										`No prerenderable params found for ${page}, skipping prerendering`,
									)
								}

								const dynamicPrerenderableRoutes = createPrerenderRoutesFromParamsList(
									route,
									paramsList,
								)

								if (!dynamicPrerenderableRoutes?.length) {
									this.buildContext?.logger.warn(
										'[process]',
										`No prerenderable routes found for ${page}, skipping prerendering`,
									)
								} else {
									for (const r of dynamicPrerenderableRoutes) prerenderableRoutes.add(r)
								}
							}
						}

						imports.components.dynamic.set(entryId, pageImport)
						processed.add(page)
					}

					const entry: Segment = {
						__id: entryId,
						__path: route,
						__params: params,
						__kind: EntryKind.PAGE,
						__depth: depth,
						method: 'get' as const,
						paths: {
							layouts: [shell, ...layouts].map(l =>
								l ? RouteProcessor.getImportPath(l) : null,
							),
							'404s': notFounds.map(e => (e ? RouteProcessor.getImportPath(e) : null)),
							loaders: loaders.map(l => (l ? RouteProcessor.getImportPath(l) : null)),
							middlewares: middlewares.map(m =>
								m ? RouteProcessor.getImportPath(m) : null,
							),
							page: page ? RouteProcessor.getImportPath(page) : null,
						},
						prerender: shouldPrerender,
						dynamic: isDynamic,
						catch_all: isCatchAll,
					}

					if (manifest[route]) {
						if (Array.isArray(manifest[route])) {
							manifest[route].push(entry)
						} else {
							manifest[route] = [manifest[route], entry]
						}
					} else {
						manifest[route] = entry
					}

					modules[entryId] = {
						shellId,
						layoutIds,
						pageId: page ? entryId : undefined,
						'404Ids': notFoundIds,
						loadingIds,
						middlewareIds,
					}
				} catch (err) {
					this.buildContext?.logger.error('[process]: failed to process segment', err)
				}
			}

			for (const endpoint of res.endpoints) {
				try {
					if (!this.buildContext || processed.has(endpoint.file)) continue

					const route = RouteProcessor.toCanonicalRoute(endpoint.file)
					const params = RouteProcessor.getParams(endpoint.file)

					const code = await Bun.file(endpoint.file).text()
					const exports = this.buildContext.transpiler.scan(code).exports

					const group: Endpoint[] = []

					for (const method of exports) {
						if (!HTTP_VERBS.includes(method as HttpMethod)) {
							this.buildContext?.logger.warn(
								'[process]',
								`Ignoring unsupported HTTP verb: ${method} in ${endpoint.file}`,
							)
							continue
						}

						const m = method.toLowerCase() as Lowercase<HttpMethod>
						const endpointId = `${EntryKind.ENDPOINT}${Bun.hash(RouteProcessor.getImportPath(endpoint.file))}_${m}`

						const middlewareIds = endpoint.middlewares.map(middleware => {
							if (!middleware) return null

							const middlewareImport = RouteProcessor.getImportPath(middleware)
							const middlewareId = `${EntryKind.MIDDLEWARE}${Bun.hash(middlewareImport)}`

							if (!processed.has(middleware)) {
								imports.middlewares.static.set(middlewareId, middlewareImport)
								processed.add(middleware)
							}

							return middlewareId
						})

						group.push({
							__id: endpointId,
							__path: route,
							__params: params,
							__kind: EntryKind.ENDPOINT,
							method: m,
							middlewares: endpoint.middlewares,
						})

						imports.endpoints.static.set(
							endpointId,
							RouteProcessor.getImportPath(endpoint.file),
						)
						modules[endpointId] = { endpointId, middlewareIds }
						processed.add(endpoint.file)
					}

					const entry = group.length === 1 ? group[0] : group

					if (endpoint.middlewares.length) {
						modules[route] = {
							...(modules[route] ?? {}),
							middlewareIds: endpoint.middlewares.map(m =>
								m
									? `${EntryKind.MIDDLEWARE}${Bun.hash(RouteProcessor.getImportPath(m))}`
									: null,
							),
						}
					}

					if (manifest[route]) {
						if (Array.isArray(manifest[route])) {
							manifest[route] = [
								...manifest[route],
								...(Array.isArray(entry) ? entry : [entry]),
							]
						} else {
							manifest[route] = [
								manifest[route],
								...(Array.isArray(entry) ? entry : [entry]),
							]
						}
					} else {
						manifest[route] = entry
					}
				} catch (err) {
					this.buildContext?.logger.error('[process]: failed to process route', err)
				}
			}

			return { manifest, imports, prerenderableRoutes, modules }
		}
	}
}
