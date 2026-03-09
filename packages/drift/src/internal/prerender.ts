import path from 'node:path';

import type { BuildContext } from '../types';

import { Drift } from '../drift';

import { Logger } from '../utils/logger';
import { Time } from '../utils/time';

const logger = new Logger()

export namespace Prerender {
	const DEFAULT_TIMEOUT_MS = 15_000
	const DEFAULT_CONCURRENCY = 4

	export namespace Artifact {
		const manifestCache = new Map<string, Manifest | null>()

		export type Mode = 'full' | 'ppr'
		export type File = 'html' | 'prelude' | 'postponed' | 'metadata'

		export type Value = {
			schema: string
			route: string
			createdAt: number
			mode: Mode
			html: string
			postponed?: unknown
		}

		export type Metadata = Pick<Value, 'schema' | 'route' | 'createdAt' | 'mode'>

		export type ManifestEntry = {
			mode: Mode
			createdAt: number
			files?: File[]
		}

		export type Manifest = {
			generatedAt: number
			routes: Record<string, ManifestEntry>
		}

		/**
		 * Get the root directory path where prerender artifacts are stored, 
		 * based on the output directory specified in the configuration
		 * @param outDir - the base output directory for build artifacts
		 * @returns the path where prerender artifacts are stored
		 */
		export function getRootPath(outDir: string) {
			return path.join(outDir, Drift.Config.GENERATED_DIR, 'ppr')
		}

		/**
		 * Get the file system path for the prerender artifact manifest, which 
		 * contains metadata about all prerendered routes and their artifacts
		 * @param outDir - the base output directory for build artifacts
		 * @returns the file system path where the prerender artifact manifest is stored
		 */
		export function getManifestPath(outDir: string) {
			return path.join(getRootPath(outDir), 'manifest.json')
		}

		/**
		 * Get the file system path for storing prerender artifacts for a given route
		 * @param outDir - the base output directory for build artifacts
		 * @param pathname - the url pathname for which to get the artifact path
		 * @returns the file system path where prerender artifacts for the given route should be stored
		 */
		export function getPath(outDir: string, pathname: string) {
			const dir = pathname === '/' ? 'index' : pathname.replace(/^\//, '')

			return path.join(getRootPath(outDir), dir)
		}

		/**
		 * Load the prerender artifact manifest for faster runtime route mode checks
		 * @param outDir - the base output directory for build artifacts
		 * @returns the manifest object if it exists and is valid, or null
		 */
		export async function loadManifest(outDir: string) {
			// if we already loaded this outDir, return cached result
			// (either a valid manifest or null when it was missing/invalid)
			if (manifestCache.has(outDir)) {
				return manifestCache.get(outDir) ?? null
			}

			const file = Bun.file(getManifestPath(outDir))
			
			// no manifest means no prerender metadata to use
			if (!(await file.exists())) {
				manifestCache.set(outDir, null)
				return null
			}

			try {
				// parse once, then validate the shape before trusting any fields
				const value = JSON.parse(await file.text())

				if (!value || typeof value !== 'object') {
					manifestCache.set(outDir, null)
					return null
				}

				const generatedAt = (value as { generatedAt?: unknown }).generatedAt
				const routes = (value as { routes?: unknown }).routes

				if (typeof generatedAt !== 'number') {
					manifestCache.set(outDir, null)
					return null
				}

				if (!routes || typeof routes !== 'object') {
					manifestCache.set(outDir, null)
					return null
				}

				// verify each route entry so runtime can rely on mode/files safely
				for (const entry of Object.values(routes)) {
					if (!entry || typeof entry !== 'object') {
						manifestCache.set(outDir, null)
						return null
					}

					const { mode, createdAt, files } = entry

					// only allow known modes
					if (mode !== 'full' && mode !== 'ppr') {
						manifestCache.set(outDir, null)
						return null
					}

					if (typeof createdAt !== 'number') {
						manifestCache.set(outDir, null)
						return null
					}

					if (files !== undefined) {
						if (!Array.isArray(files)) {
							manifestCache.set(outDir, null)
							return null
						}

						// only allow known artifact file labels
						for (const f of files) {
							if (
								f !== 'html' &&
								f !== 'prelude' &&
								f !== 'postponed' &&
								f !== 'metadata'
							) {
								manifestCache.set(outDir, null)
								return null
							}
						}
					}
				}

				const manifest = { generatedAt, routes } as Manifest
				// cache validated manifest to avoid reparsing on every request
				manifestCache.set(outDir, manifest)

				return manifest
			} catch {
				manifestCache.set(outDir, null)
				return null
			}
		}

		/**
		 * Load the postponed state for a given route from the file system, if it exists
		 * @param outDir - the base output directory for build artifacts
		 * @param pathname - the url pathname for which to load the postponed state
		 * @returns the postponed state object if it exists and is valid, or null if it doesn't exist or is invalid
		 */
		export async function loadPostponedState(outDir: string, pathname: string) {
			const file = Bun.file(path.join(getPath(outDir, pathname), 'postponed.json'))
			if (!(await file.exists())) return null

			try {
				return JSON.parse(await file.text())
			} catch {
				return null
			}
		}

		/**
		 * Load the prelude HTML for a given route from the file system, if it exists
		 * @param outDir - the base output directory for build artifacts
		 * @param pathname - the url pathname for which to load the prelude HTML
		 * @returns the prelude HTML string if it exists, or null if it doesn't exist or can't be read
		 */
		export async function loadPrelude(outDir: string, pathname: string) {
			const file = Bun.file(path.join(getPath(outDir, pathname), 'prelude.html'))
			if (!(await file.exists())) return null

			try {
				return await file.text()
			} catch {
				return null
			}
		}

		/**
		 * Load the prerender artifact metadata for a given route from the file system, if it exists and is valid
		 * @param outDir - the base output directory for build artifacts
		 * @param pathname - the url pathname for which to load the artifact metadata
		 * @returns the artifact metadata object if it exists and is valid, or null if it doesn't exist or is invalid
		 */
		export async function loadMetadata(outDir: string, pathname: string) {
			const file = Bun.file(path.join(getPath(outDir, pathname), 'metadata.json'))
			if (!(await file.exists())) return null

			try {
				const value = JSON.parse(await file.text())
				if (!value || typeof value !== 'object') return null

				const schema = (value as { schema?: unknown }).schema
				const route = (value as { route?: unknown }).route
				const createdAt = (value as { createdAt?: unknown }).createdAt
				const mode = (value as { mode?: unknown }).mode

				if (typeof schema !== 'string') return null
				if (typeof route !== 'string') return null
				if (typeof createdAt !== 'number') return null
				if (mode !== 'full' && mode !== 'ppr') return null

				return { schema, route, createdAt, mode } satisfies Metadata
			} catch {
				return null
			}
		}

		/**
		 * Check if a prerender artifact is compatible with the current application version and route,
		 * based on its metadata
		 * @param artifactMetadata - the metadata of the prerender artifact to check
		 * @param pathname - the url pathname for which to check compatibility
		 * @param mode - the prerendering mode ('full' or 'ppr') for which to check compatibility
		 * @returns true if the artifact is compatible with the current application version and route,
		 * false otherwise
		 */
		export function isCompatible(
			artifactMetadata: Metadata,
			pathname: string,
			mode: Mode,
		) {
			const schema = Drift.getVersion()

			return (
				artifactMetadata.schema === schema &&
				artifactMetadata.route === pathname &&
				artifactMetadata.mode === mode
			)
		}

		/**
		 * Compose the prelude HTML and the resume stream into a single HTML stream, by injecting the resume stream
		 * into the prelude at the appropriate location (before </body> or </html>)
		 * @param prelude - the prelude HTML string
		 * @param resumeStream - the ReadableStream containing the HTML from react-resume
		 * @returns a ReadableStream that outputs the combined HTML of the prelude and the resume stream
		 */
		export function composePreludeAndResume(
			prelude: string,
			resumeStream: ReadableStream<Uint8Array>,
		) {
			const lower = prelude.toLowerCase()
			const bodyClose = lower.lastIndexOf('</body>')
			const htmlClose = lower.lastIndexOf('</html>')
			const splitAt = bodyClose >= 0 && htmlClose > bodyClose ? bodyClose : prelude.length

			return new ReadableStream<Uint8Array>({
				async start(controller) {
					const encoder = new TextEncoder()
					const decoder = new TextDecoder()

					controller.enqueue(new TextEncoder().encode(prelude.slice(0, splitAt)))

					const reader = resumeStream.getReader()
					let strippedLeadingClose = false

					try {
						while (true) {
							const { value, done } = await reader.read()

							if (done) break
							if (!value) continue

							if (!strippedLeadingClose) {
								strippedLeadingClose = true

								const text = decoder.decode(value)
								const trimmed = text.replace(/^\s*<\/body>\s*<\/html>/i, '')

								if (trimmed.length > 0) controller.enqueue(encoder.encode(trimmed))

								continue
							}

							controller.enqueue(value)
						}
					} finally {
						reader.releaseLock()
						controller.close()
					}
				},
			})
		}
	}

	export type Result =
		| { route: string; artifact: Artifact.Value }
		| { route: string; status: number }
		| { route: string; error: unknown }

	export namespace Runtime {
		/**
		 * Custom error class to indicate that prerendering has been postponed to request-time
		 */
		export class Postponed extends Error {
			constructor(message: string = 'postponed') {
				super(message)
				this.name = 'Postponed'
			}
		}

		/**
		 * Type guard to check if an error is a Postponed error, including wrapped errors like
		 * AbortError or TimeoutError
		 * @param error - the error to check
		 * @returns true if the error is a Postponed error or caused by a Postponed error, false otherwise
		 */
		export function isPostponed(error: unknown) {
			if (error instanceof Postponed) return true

			if (
				error instanceof Error &&
				(error.name === 'AbortError' || error.name === 'TimeoutError')
			) {
				if (error.cause instanceof Postponed) return true
			}

			return false
		}
	}

	export namespace Build {
		/**
		 * Get the prerender timeout value from the environment variable, or return the default
		 * if it's not set or invalid
		 * @returns the prerender timeout in milliseconds
		 */
		export function getTimeout() {
			const v = Number(process.env.DRIFT_PRERENDER_TIMEOUT_MS)

			if (!Number.isFinite(v) || v <= 0) {
				return DEFAULT_TIMEOUT_MS
			}

			return v
		}

		/**
		 * Get the prerender concurrency value from the environment variable, or return the default
		 * if it's not set or invalid
		 * @returns the prerender concurrency as a number
		 */
		export function getConcurrency() {
			const v = Number(process.env.DRIFT_PRERENDER_CONCURRENCY)

			if (!Number.isInteger(v) || v <= 0) {
				return DEFAULT_CONCURRENCY
			}

			return v
		}

		/**
		 * Extract the prerendering mode ('full', 'ppr', or false) from the source code of a route module, by
		 * looking for an exported `prerender` constant
		 * @param filePath - the file system path to the route module
		 * @returns 'full' or 'ppr' if the prerender mode is specified in the module, false if prerendering is
		 * explicitly disabled, or undefined if no prerender mode is specified
		 * @throws if the file cannot be read or if the exported `prerender` constant has an invalid value
		 */
		export async function getStaticFlag(filePath: string) {
			const code = await Bun.file(filePath).text()

			const match = code.match(
				/\bexport\s+const\s+prerender\s*=\s*(?:(['"`])(?<mode>full|ppr)\1|(?<disabled>false))(?=\s|;|$)/,
			)

			if (!match?.groups) return
			if (match.groups.disabled === 'false') return false

			const mode = match.groups.mode
			if (mode === 'full' || mode === 'ppr') return mode

			return
		}

		/**
		 * Get the list of static parameters for a dynamic route, by looking for an exported `params` function
		 * in the route module and calling it to get the list of parameter objects
		 * @param filePath - the file system path to the route module
		 * @param buildContext - the build context object, used to transpile and execute the route module code
		 * @returns an array of parameter objects returned by the 'params' function, or an empty array if there is
		 * no 'params' function or if it doesn't return a valid array
		 * @throws if the file cannot be read, if the code cannot be transpiled or executed, or if the 'params'
		 * function throws an error
		 */
		export async function getStaticParams(filePath: string, buildContext: BuildContext) {
			const code = await Bun.file(filePath).text()
			const exports = buildContext.transpiler.scan(code).exports

			if (!exports.includes('params')) return []

			const abs = path.resolve(process.cwd(), filePath)
			const mod = await import(/* @vite-ignore */ abs)

			if (typeof mod.params !== 'function') return []
			return Promise.try(() => mod.params())
		}

		/**
		 * Generate the list of prerenderable routes for a dynamic route, by combining the static parameters obtained from
		 * the route module with the route pattern, and filtering out any routes that still contain dynamic segments
		 * @param route - the route pattern, e.g. '/blog/:slug'
		 * @param params - the list of parameter objects, e.g. [{ slug: 'post-1' }, { slug: 'post-2' }]
		 * @returns an array of prerenderable route paths generated by replacing the dynamic segments in the route pattern
		 * with the corresponding values from the parameter objects, and filtering out any paths that still contain
		 * dynamic segments (i.e. segments that start with ':' or '*')
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

		/**
		 * Function to prerender a single route by making a request to the route with special headers, and returning the
		 * result which includes either the prerender artifact or an error/status code if the prerendering failed or was
		 * postponed to request-time
		 * @param app - an object with a 'fetch' method that can be used to make requests to the application routes
		 * @param route - the url route to prerender, e.g. '/blog/post-1'
		 * @param opts - options for the prerendering process, including the timeout duration and an optional origin to
		 * use for the request
		 * @return a promise that resolves to an object containing the prerendering result
		 */
		export async function get(
			app: { fetch: (req: Request) => Promise<Response> },
			route: string,
			opts: { timeout: number; origin?: string },
		) {
			const url = `${opts.origin ?? 'http://drift.local'}${route}`

			const res = await Time.timeout(
				app.fetch(
					new Request(url, {
						headers: {
							Accept: 'text/html',
							'x-drift-prerender': '1',
							'x-drift-prerender-artifact': '1',
						},
					}),
				),
				opts.timeout,
				`route ${route}`,
			)

			if (!(res instanceof Response)) {
				const error = new Error(`Invalid response for ${route}`)
				logger.error(`[prerender:get] ${error.message}`, error)

				throw error
			}

			if (!res.ok) return { route, status: res.status } satisfies Result

			return { route, artifact: await res.json() } satisfies Result
		}

		/**
		 * Run the prerendering process for a list of routes, with a specified concurrency limit and timeout for
		 * each route, by calling the 'get' function for each route and yielding the results as they
		 * become available
		 * @param app - an object with a 'fetch' method that can be used to make requests to the application routes
		 * @param routes - an array of url routes to prerender, e.g. ['/blog/post-1', '/blog/post-2']
		 * @param opts - options for the prerendering process, including the timeout duration, concurrency limit,
		 * and an optional origin to use for the requests
		 * @returns an async generator that yields the prerendering results for each route as they become available
		 */
		export async function* run(
			app: { fetch: (req: Request) => Promise<Response> },
			routes: string[],
			opts: { timeout: number; concurrency?: number; origin?: string },
		) {
			const limit = Math.max(1, Math.min(opts.concurrency ?? 4, routes.length || 1))

			let index = 0

			const pending = new Map<
				number,
				Promise<{
					index: number
					result: Result
				}>
			>()

			function enqueue() {
				while (index < routes.length && pending.size < limit) {
					const i = index++
					const value = routes[i]

					pending.set(
						i,
						get(app, value, {
							timeout: opts.timeout,
							origin: opts.origin,
						})
							.then(result => ({ index: i, result }))
							.catch(err => ({
								index: i,
								result: { route: value, error: err } as Result,
							})),
					)
				}
			}

			enqueue()

			while (pending.size > 0) {
				const settled = await Promise.race(pending.values())

				pending.delete(settled.index)
				yield settled.result

				enqueue()
			}
		}
	}
}
