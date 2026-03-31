import type { Dirent } from 'node:fs'

import fs from 'node:fs/promises'
import path from 'node:path'

import type {
	BuildContext,
	Endpoint,
	HttpMethod,
	PluginConfig,
	Route,
	Segment,
} from '../types'

import { Solas } from '../solas'

import { Logger } from '../utils/logger'

import { Prerender } from './prerender'

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
			// 401 boundary chain
			'401s': (string | null)[]
			// 403 boundary chain
			'403s': (string | null)[]
			// 404 boundary chain
			'404s': (string | null)[]
			// 500 boundary chain
			'500s': (string | null)[]
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
			'401Ids'?: (string | null)[]
			'403Ids'?: (string | null)[]
			'404Ids'?: (string | null)[]
			'500Ids'?: (string | null)[]
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
		401: '$401',
		403: '$403',
		404: '$404',
		500: '$500',
		LOADING: '$LOAD',
		MIDDLEWARE: '$MW',
		ENDPOINT: '$E',
	} as const

	const logger = new Logger()

	/**
	 * Finder class to process application routes
	 */
	export class Finder {
		constructor(
			public readonly buildContext: BuildContext,
			public readonly config: PluginConfig,
		) {}

		/**
		 * Extracts dynamic parameter names from a file path
		 */
		static getParams(file: string) {
			return Array.from(file.matchAll(/\[(?:\.\.\.)?([^\]]+)\]/g), m => m[1])
		}

		/**
		 * Get the depth of a route based on slashes
		 */
		static getDepth(route: string) {
			if (route === '/') return 0

			// count slashes to determine depth
			return route.split('/').length - 1
		}

		/**
		 * Convert a file path to a canonical route.
		 */
		static toCanonicalRoute(file: string) {
			const route = file
				.replace(new RegExp(`^${Solas.Config.APP_DIR}`), '')
				.replace(/\/\+page\.(j|t)sx?$/, '')
				.replace(/\/\+endpoint\.(j|t)sx?$/, '')
				.replace(/\[\.\.\..+?\]/g, '*') // wildcard routes
				.replace(/\[(.+?)\]/g, ':$1') // dynamic routes

			if (!route || route === '') return '/'

			return route.startsWith('/') ? route : `/${route}`
		}

		/**
		 * Get the import path for a file
		 * This finds the relative path from the generated
		 * directory to the file, removes the extension and
		 * replaces backslashes with forward slashes.
		 */
		static getImportPath(file: string) {
			const cwd = process.cwd()
			const generatedDir = path.join(cwd, Solas.Config.GENERATED_DIR)

			return path
				.relative(generatedDir, path.resolve(cwd, file))
				.replace(/\\/g, '/')
				.replace(/\.(t|j)sx?$/, '')
		}

		/**
		 * Run the Finder to get the app route and associated data
		 * needed for codegen
		 */
		async run() {
			try {
				return await this.process(await this.#scan(Solas.Config.APP_DIR))
			} catch (err) {
				logger.error('[Build:Finder:run]: failed to build manifest', err)
				throw err
			}
		}

		/**
		 * Scan the filesystem to get all routes for processing
		 */
		async #scan(
			dir: string,
			res: ScanResult = { segments: [], endpoints: [] },
			prev: {
				layouts: (string | null)[]
				'401s': (string | null)[]
				'403s': (string | null)[]
				'404s': (string | null)[]
				'500s': (string | null)[]
				loaders: (string | null)[]
				middlewares: (string | null)[]
			} = {
				layouts: [],
				'401s': [],
				'403s': [],
				'404s': [],
				'500s': [],
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
					'401': '+401',
					'403': '+403',
					'404': '+404',
					'500': '+500',
					layout: '+layout',
					loading: '+loading',
					middleware: '+middleware',
					endpoint: '+endpoint',
				} as const

				// map of valid files for each type
				const validFiles = {
					[TYPES.page]: new Set(EXTENSIONS.page.map(ext => `${TYPES.page}.${ext}`)),
					[TYPES['401']]: new Set(EXTENSIONS.page.map(ext => `${TYPES['401']}.${ext}`)),
					[TYPES['403']]: new Set(EXTENSIONS.page.map(ext => `${TYPES['403']}.${ext}`)),
					[TYPES['404']]: new Set(EXTENSIONS.page.map(ext => `${TYPES['404']}.${ext}`)),
					[TYPES['500']]: new Set(EXTENSIONS.page.map(ext => `${TYPES['500']}.${ext}`)),
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
							if (validFiles[TYPES['401']].has(base)) return 1
							if (validFiles[TYPES['403']].has(base)) return 2
							if (validFiles[TYPES['404']].has(base)) return 3
							if (validFiles[TYPES['500']].has(base)) return 4
							if (validFiles[TYPES.loading].has(base)) return 5
							if (validFiles[TYPES.middleware].has(base)) return 6
							if (validFiles[TYPES.page].has(base)) return 7
							if (validFiles[TYPES.endpoint].has(base)) return 8

							return 8
						}

						return priority(a) - priority(b)
					}

					return 0
				})

				// current layout, status boundaries, loader, middleware, and page files for this segment
				let currentLayout: string | undefined
				let current401: string | undefined
				let current403: string | undefined
				let current404: string | undefined
				let current500: string | undefined
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
							const unauthorized = [...prev['401s'], current401 ?? null]
							const forbidden = [...prev['403s'], current403 ?? null]
							const notFounds = [...prev['404s'], current404 ?? null]
							const serverErrors = [...prev['500s'], current500 ?? null]
							const loaders = [...prev.loaders, currentLoader ?? null]
							const middlewares = [...prev.middlewares, currentMiddleware ?? null]
							const shell = layouts[0]

							if (shell) {
								res.segments.push({
									dir,
									page: undefined,
									'401s': unauthorized,
									'403s': forbidden,
									'404s': notFounds,
									'500s': serverErrors,
									loaders,
									middlewares,
									layouts: layouts.length > 1 ? layouts.slice(1) : [],
									shell,
								})
							}
						}

						const next = {
							layouts: [...prev.layouts, currentLayout ?? null],
							'401s': [...prev['401s'], current401 ?? null],
							'403s': [...prev['403s'], current403 ?? null],
							'404s': [...prev['404s'], current404 ?? null],
							'500s': [...prev['500s'], current500 ?? null],
							loaders: [...prev.loaders, currentLoader ?? null],
							middlewares: [...prev.middlewares, currentMiddleware ?? null],
						}

						await this.#scan(route, res, next)
					} else {
						const base = path.basename(file.name)
						const relative = path.relative(process.cwd(), route).replace(/\\/g, '/')

						if (validFiles[TYPES.layout].has(base)) {
							currentLayout = relative
						} else if (validFiles[TYPES['401']].has(base)) {
							current401 = relative
						} else if (validFiles[TYPES['403']].has(base)) {
							current403 = relative
						} else if (validFiles[TYPES['404']].has(base)) {
							current404 = relative
						} else if (validFiles[TYPES['500']].has(base)) {
							current500 = relative
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
							const unauthorized = [...prev['401s'], current401 ?? null]
							const forbidden = [...prev['403s'], current403 ?? null]
							const notFounds = [...prev['404s'], current404 ?? null]
							const serverErrors = [...prev['500s'], current500 ?? null]
							const loaders = [...prev.loaders, currentLoader ?? null]
							const middlewares = [...prev.middlewares, currentMiddleware ?? null]
							const shell = layouts?.[0]

							if (!shell) throw new Error('Missing app shell')

							res.segments.push({
								dir,
								page: relative,
								'401s': unauthorized,
								'403s': forbidden,
								'404s': notFounds,
								'500s': serverErrors,
								loaders,
								middlewares,
								layouts: layouts.length > 1 ? layouts.slice(1) : [],
								shell,
							})
						}
					}
				}

				// warn if segment has status boundaries/loading but no page or layout
				if (
					!currentPage &&
					!currentLayout &&
					(current401 || current403 || current404 || current500 || currentLoader)
				) {
					logger.warn(
						`[Build:Finder:#scan]: ${dir} has status route files or +loading but no +page or +layout. This path will not be routable (404), but these files will still be inherited by child routes`,
					)
				}

				// create segment if we have a layout but no page and
				// haven't created one yet (no subdirectories triggered it)
				if (!currentPage && currentLayout && !res.segments.some(s => s.dir === dir)) {
					const layouts = [...prev.layouts, currentLayout]
					const unauthorized = [...prev['401s'], current401 ?? null]
					const forbidden = [...prev['403s'], current403 ?? null]
					const notFounds = [...prev['404s'], current404 ?? null]
					const serverErrors = [...prev['500s'], current500 ?? null]
					const loaders = [...prev.loaders, currentLoader ?? null]
					const middlewares = [...prev.middlewares, currentMiddleware ?? null]
					const shell = layouts[0]

					if (shell) {
						res.segments.push({
							dir,
							page: undefined,
							'401s': unauthorized,
							'403s': forbidden,
							'404s': notFounds,
							'500s': serverErrors,
							loaders,
							middlewares,
							layouts: layouts.length > 1 ? layouts.slice(1) : [],
							shell,
						})
					}
				}

				return res satisfies ScanResult
			} catch (err) {
				logger.error(`[Build:Finder:#scan]: Failed to compose manifest from ${dir}`, err)

				return {
					segments: [],
					endpoints: [],
				} satisfies ScanResult
			}
		}

		/**
		 * Process the scanned route data
		 */
		async process(res: ScanResult) {
			const processed = new Set<string>()
			const prerenderedRoutes = new Set<string>()
			const trailingSlash = this.config?.trailingSlash ?? 'never'

			const manifest: Record<string, Segment | Endpoint | (Segment | Endpoint)[]> = {}

			// imports for endpoints and components
			const imports: Imports = {
				endpoints: { static: new Map() },
				components: { static: new Map(), dynamic: new Map() },
				middlewares: { static: new Map() },
			}

			const modules: Modules = {}
			const prerenderCache = new Map<string, Route.Prerender | undefined>()

			for (const segment of res.segments) {
				try {
					if (!this.buildContext || !this.config) continue

					const {
						shell: shellPath,
						layouts: layoutPaths,
						'401s': unauthorizedPaths,
						'403s': forbiddenPaths,
						page: pagePath,
						'404s': notFoundPaths,
						'500s': serverErrorPaths,
						loaders: loaderPaths,
						middlewares: middlewarePaths,
						dir,
					} = segment

					// route is derived from dir path, not page
					const route = Finder.toCanonicalRoute(
						pagePath ?? `${dir.replace(/\\/g, '/')}/+page.tsx`,
					)
					const params = Finder.getParams(dir)
					const depth = Finder.getDepth(route)

					const isDynamic = route.includes(':')
					const isWildcard = route.includes('*')

					// effective mode for this segment; start from global config then
					// apply shell/layout/page overrides
					let currentPrerenderMode: Route.Prerender = this.config?.prerender ?? false

					/**
					 * Apply explicit prerender mode overrides in inheritance order
					 */
					function applyPrerenderMode(flag: Route.Prerender | undefined) {
						if (flag === undefined) return
						currentPrerenderMode = flag
					}

					const shellImport = Finder.getImportPath(shellPath)

					const shellId = `${EntryKind.SHELL}${Bun.hash(shellImport)}`
					const layoutIds: (string | null)[] = []
					const unauthorizedIds: (string | null)[] = []
					const forbiddenIds: (string | null)[] = []
					const notFoundIds: (string | null)[] = []
					const serverErrorIds: (string | null)[] = []
					const loadingIds: (string | null)[] = []
					const middlewareIds: (string | null)[] = []

					// check shell prerender
					if (!processed.has(shellPath)) {
						prerenderCache.set(
							shellPath,
							await Prerender.Build.getStaticFlag(shellPath, this.buildContext),
						)
						imports.components.static.set(shellId, shellImport)
						processed.add(shellPath)
					}

					applyPrerenderMode(prerenderCache.get(shellPath))

					for (const layoutPath of layoutPaths) {
						if (!layoutPath) {
							layoutIds.push(null)
							continue
						}

						const layoutImport = Finder.getImportPath(layoutPath)
						const layoutId = `${EntryKind.LAYOUT}${Bun.hash(layoutImport)}`

						if (!processed.has(layoutPath)) {
							prerenderCache.set(
								layoutPath,
								await Prerender.Build.getStaticFlag(layoutPath, this.buildContext),
							)
							imports.components.dynamic.set(layoutId, layoutImport)
							processed.add(layoutPath)
						}

						applyPrerenderMode(prerenderCache.get(layoutPath))
						layoutIds.push(layoutId)
					}

					for (const unauthorizedPath of unauthorizedPaths) {
						if (!unauthorizedPath) {
							unauthorizedIds.push(null)
							continue
						}

						const unauthorizedImport = Finder.getImportPath(unauthorizedPath)
						const unauthorizedId = `${EntryKind['401']}${Bun.hash(unauthorizedImport)}`

						unauthorizedIds.push(unauthorizedId)

						if (!processed.has(unauthorizedPath)) {
							imports.components.dynamic.set(unauthorizedId, unauthorizedImport)
							processed.add(unauthorizedPath)
						}
					}

					for (const forbiddenPath of forbiddenPaths) {
						if (!forbiddenPath) {
							forbiddenIds.push(null)
							continue
						}

						const forbiddenImport = Finder.getImportPath(forbiddenPath)
						const forbiddenId = `${EntryKind['403']}${Bun.hash(forbiddenImport)}`

						forbiddenIds.push(forbiddenId)

						if (!processed.has(forbiddenPath)) {
							imports.components.dynamic.set(forbiddenId, forbiddenImport)
							processed.add(forbiddenPath)
						}
					}

					for (const notFoundPath of notFoundPaths) {
						// hole if level does not declare a 404 boundary.
						// Keep slot so indices match layouts
						if (!notFoundPath) {
							notFoundIds.push(null)
							continue
						}

						const notFoundImport = Finder.getImportPath(notFoundPath)
						const notFoundId = `${EntryKind['404']}${Bun.hash(notFoundImport)}`

						notFoundIds.push(notFoundId)

						// dedupe imports but still assign the slot for this route
						if (!processed.has(notFoundPath)) {
							imports.components.dynamic.set(notFoundId, notFoundImport)
							processed.add(notFoundPath)
						}
					}

					for (const serverErrorPath of serverErrorPaths) {
						if (!serverErrorPath) {
							serverErrorIds.push(null)
							continue
						}

						const serverErrorImport = Finder.getImportPath(serverErrorPath)
						const serverErrorId = `${EntryKind['500']}${Bun.hash(serverErrorImport)}`

						serverErrorIds.push(serverErrorId)

						if (!processed.has(serverErrorPath)) {
							imports.components.dynamic.set(serverErrorId, serverErrorImport)
							processed.add(serverErrorPath)
						}
					}

					for (const loaderPath of loaderPaths) {
						// hole if level does not declare a loader.
						// Keep slot so indices match layouts
						if (!loaderPath) {
							loadingIds.push(null)
							continue
						}

						const loaderImport = Finder.getImportPath(loaderPath)
						const loaderId = `${EntryKind.LOADING}${Bun.hash(loaderImport)}`

						loadingIds.push(loaderId)

						// dedupe imports but still assign the slot for this route
						if (!processed.has(loaderPath)) {
							imports.components.dynamic.set(loaderId, loaderImport)
							processed.add(loaderPath)
						}
					}

					for (const middlewarePath of middlewarePaths) {
						if (!middlewarePath) {
							middlewareIds.push(null)
							continue
						}

						const middlewareImport = Finder.getImportPath(middlewarePath)
						const middlewareId = `${EntryKind.MIDDLEWARE}${Bun.hash(middlewareImport)}`

						middlewareIds.push(middlewareId)

						if (!processed.has(middlewarePath)) {
							// route scanning only tells us this is a +middleware file path so
							// we still validate that the module actually exports middleware
							if (
								!(await this.buildContext.exportReader.has(middlewarePath, 'middleware'))
							) {
								throw new Error(`Missing middleware export in ${middlewarePath}`)
							}

							imports.middlewares.static.set(middlewareId, middlewareImport)
							processed.add(middlewarePath)
						}
					}

					// generate entry id based on page if exists, otherwise dir
					const entryId = pagePath
						? `${EntryKind.PAGE}${Bun.hash(Finder.getImportPath(pagePath))}`
						: `${EntryKind.PAGE}${Bun.hash(route)}`

					if (pagePath) {
						const pagePrerender = await Prerender.Build.getStaticFlag(
							pagePath,
							this.buildContext,
						)
						applyPrerenderMode(pagePrerender)

						imports.components.dynamic.set(entryId, Finder.getImportPath(pagePath))
						processed.add(pagePath)
					}

					const shouldPrerender = currentPrerenderMode !== false
					const prerenderMode: Route.Prerender = shouldPrerender
						? currentPrerenderMode
						: false

					if (shouldPrerender) {
						if (!isDynamic && !isWildcard) {
							prerenderedRoutes.add(Prerender.Build.normaliseRoute(route, trailingSlash))
						} else if (pagePath) {
							const staticParams = await Prerender.Build.getStaticParams(
								pagePath,
								this.buildContext,
							)

							for (const r of Prerender.Build.getDynamicRouteList(
								route,
								params,
								staticParams,
							)) {
								prerenderedRoutes.add(Prerender.Build.normaliseRoute(r, trailingSlash))
							}
						}
					}

					const entry: Segment = {
						__id: entryId,
						__path: route,
						__params: params,
						__kind: EntryKind.PAGE,
						__depth: depth,
						method: 'get' as const,
						paths: {
							layouts: [shellPath, ...layoutPaths].map(layout =>
								layout ? Finder.getImportPath(layout) : null,
							),
							'401s': unauthorizedPaths.map(unauthorized =>
								unauthorized ? Finder.getImportPath(unauthorized) : null,
							),
							'403s': forbiddenPaths.map(forbidden =>
								forbidden ? Finder.getImportPath(forbidden) : null,
							),
							'404s': notFoundPaths.map(notFound =>
								notFound ? Finder.getImportPath(notFound) : null,
							),
							'500s': serverErrorPaths.map(serverError =>
								serverError ? Finder.getImportPath(serverError) : null,
							),
							loaders: loaderPaths.map(loader =>
								loader ? Finder.getImportPath(loader) : null,
							),
							middlewares: middlewarePaths.map(middleware =>
								middleware ? Finder.getImportPath(middleware) : null,
							),
							page: pagePath ? Finder.getImportPath(pagePath) : null,
						},
						prerender: prerenderMode,
						dynamic: isDynamic,
						wildcard: isWildcard,
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
						pageId: pagePath ? entryId : undefined,
						'401Ids': unauthorizedIds,
						'403Ids': forbiddenIds,
						'404Ids': notFoundIds,
						'500Ids': serverErrorIds,
						loadingIds,
						middlewareIds,
					}
				} catch (err) {
					if (
						err instanceof Error &&
						err.message.startsWith('Missing middleware export')
					) {
						throw err
					}

					logger.error('[Build:Finder:process]: failed to process segment', err)
				}
			}

			for (const endpoint of res.endpoints) {
				try {
					const endpointFilePath = endpoint.file
					const endpointMiddlewarePaths = endpoint.middlewares

					if (!this.buildContext || processed.has(endpointFilePath)) continue

					const route = Finder.toCanonicalRoute(endpointFilePath)
					const params = Finder.getParams(endpointFilePath)

					const endpointExports =
						await this.buildContext.exportReader.exports(endpointFilePath)

					const group: Endpoint[] = []

					for (const method of endpointExports) {
						if (!HTTP_VERBS.includes(method as HttpMethod)) {
							logger.warn(
								'[Build:Finder:process]',
								`Ignoring unsupported HTTP verb: ${method} in ${endpointFilePath}`,
							)
							continue
						}

						const m = method.toLowerCase() as Lowercase<HttpMethod>
						const endpointId = `${EntryKind.ENDPOINT}${Bun.hash(Finder.getImportPath(endpointFilePath))}_${m}`

						const middlewareIds = await Promise.all(
							endpointMiddlewarePaths.map(async middlewarePath => {
								if (!middlewarePath) return null

								const middlewareImport = Finder.getImportPath(middlewarePath)
								const middlewareId = `${EntryKind.MIDDLEWARE}${Bun.hash(middlewareImport)}`

								if (!processed.has(middlewarePath)) {
									// endpoint middleware discovery gives us file paths, not proof of the export
									// so check the module shape before we register the import
									if (
										!(await this.buildContext.exportReader.has(
											middlewarePath,
											'middleware',
										))
									) {
										throw new Error(`Missing middleware export in ${middlewarePath}`)
									}

									imports.middlewares.static.set(middlewareId, middlewareImport)
									processed.add(middlewarePath)
								}

								return middlewareId
							}),
						)

						group.push({
							__id: endpointId,
							__path: route,
							__params: params,
							__kind: EntryKind.ENDPOINT,
							method: m,
							middlewares: endpointMiddlewarePaths.map(middlewarePath =>
								middlewarePath ? Finder.getImportPath(middlewarePath) : null,
							),
						})

						imports.endpoints.static.set(
							endpointId,
							Finder.getImportPath(endpointFilePath),
						)
						modules[endpointId] = { endpointId, middlewareIds }
						processed.add(endpointFilePath)
					}

					const entry = group.length === 1 ? group[0] : group

					if (endpointMiddlewarePaths.length) {
						modules[route] = {
							...(modules[route] ?? {}),
							middlewareIds: endpointMiddlewarePaths.map(middlewarePath =>
								middlewarePath
									? `${EntryKind.MIDDLEWARE}${Bun.hash(Finder.getImportPath(middlewarePath))}`
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
					if (
						err instanceof Error &&
						err.message.startsWith('Missing middleware export')
					) {
						throw err
					}

					logger.error('[Build:Finder:process]: failed to process route', err)
				}
			}

			return { manifest, imports, modules, prerenderedRoutes }
		}
	}
}
