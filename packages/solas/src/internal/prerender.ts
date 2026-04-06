import path from 'node:path'

import { compile } from 'path-to-regexp'

import type { BuildContext } from '../types'

import { Solas } from '../solas'

import { Logger } from '../utils/logger'
import { Time } from '../utils/time'
import { toPathPattern } from './router/utils'

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
			fullPrerenderFilename?: string
		}

		export type Manifest = {
			generatedAt: number
			routes: Record<string, ManifestEntry>
		}

		/**
		 * Check whether a file name is safe to join under an artifact directory
		 */
		function isArtifactFileName(value: unknown): value is string {
			return (
				typeof value === 'string' &&
				value.length > 0 &&
				path.basename(value) === value &&
				!value.includes(path.sep)
			)
		}

		/**
		 * Get the root directory path where prerender artifacts are stored,
		 * based on the output directory specified in the configuration
		 */
		export function getRootPath(outDir: string) {
			return path.join(outDir, Solas.Config.GENERATED_DIR, 'ppr')
		}

		/**
		 * Get the file system path for the prerender artifact manifest, which
		 * contains metadata about all prerendered routes and their artifacts
		 */
		export function getManifestPath(outDir: string) {
			return path.join(getRootPath(outDir), 'manifest.json')
		}

		/**
		 * Get the file system path for storing prerender artifacts for a given route
		 */
		export function getPath(outDir: string, pathname: string) {
			const root = path.resolve(getRootPath(outDir))
			const dir = pathname === '/' ? 'index' : pathname.replace(/^\//, '')
			const artifactPath = path.resolve(root, dir)

			// this also runs at request time, so make sure the pathname cannot escape the artifact folder
			if (artifactPath !== root && !artifactPath.startsWith(`${root}${path.sep}`)) {
				throw new Error('[prerender] invalid artifact path')
			}

			return artifactPath
		}

		/**
		 * Get the file system path for a single prerender artifact file under a route directory
		 */
		export function getFilePath(outDir: string, pathname: string, fileName: string) {
			if (!isArtifactFileName(fileName)) {
				throw new Error('[prerender] invalid artifact file name')
			}

			return path.join(getPath(outDir, pathname), fileName)
		}

		/**
		 * Build a deterministic file name for a full prerender html artifact
		 */
		export function getFullHtmlFileName(html: string) {
			return `html.${Bun.hash(html).toString(16)}.html`
		}

		/**
		 * Load the prerender artifact manifest for faster runtime route mode checks
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

					if (
						entry.fullPrerenderFilename !== undefined &&
						!isArtifactFileName(entry.fullPrerenderFilename)
					) {
						manifestCache.set(outDir, null)
						return null
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
		 */
		export async function loadPostponedState(outDir: string, pathname: string) {
			let file: Bun.BunFile

			try {
				file = Bun.file(path.join(getPath(outDir, pathname), 'postponed.json'))
			} catch (err) {
				logger.warn(
					`[prerender:artifacts] rejected postponed state path for ${pathname}`,
					Logger.print(err),
				)
				return null
			}

			if (!(await file.exists())) return null

			try {
				return JSON.parse(await file.text())
			} catch {
				return null
			}
		}

		/**
		 * Load the prelude HTML for a given route from the file system, if it exists
		 */
		export async function loadPrelude(outDir: string, pathname: string) {
			let file: Bun.BunFile

			try {
				file = Bun.file(path.join(getPath(outDir, pathname), 'prelude.html'))
			} catch (err) {
				logger.warn(
					`[prerender:artifacts] rejected prelude path for ${pathname}`,
					Logger.print(err),
				)
				return null
			}

			if (!(await file.exists())) return null

			try {
				return await file.text()
			} catch {
				return null
			}
		}

		/**
		 * Load the prerender artifact metadata for a given route from the file system, if it exists and is valid
		 */
		export async function loadMetadata(outDir: string, pathname: string) {
			let file: Bun.BunFile

			try {
				file = Bun.file(path.join(getPath(outDir, pathname), 'metadata.json'))
			} catch (err) {
				logger.warn(
					`[prerender:artifacts] rejected metadata path for ${pathname}`,
					Logger.print(err),
				)
				return null
			}

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

				return {
					schema,
					route,
					createdAt,
					mode,
				} satisfies Metadata
			} catch {
				return null
			}
		}

		/**
		 * Check if a prerender artifact is compatible with the current application version and route,
		 * based on its metadata
		 */
		export function isCompatible(
			artifactMetadata: Metadata,
			pathname: string,
			mode: Mode,
		) {
			const schema = Solas.getVersion()

			return (
				artifactMetadata.schema === schema &&
				artifactMetadata.route === pathname &&
				artifactMetadata.mode === mode
			)
		}

		// shared instances, both are stateless so one per module is fine
		const encoder = new TextEncoder()
		const decoder = new TextDecoder()

		/**
		 * Compose the prelude HTML and the resume stream into a single HTML stream, by injecting the resume stream
		 * into the prelude at the appropriate location (before </body> or </html>)
		 */
		export function composePreludeAndResume(
			prelude: string,
			resumeStream: ReadableStream<Uint8Array>,
		) {
			// `prelude` is the static shell html as one complete string, usually shaped like
			// `<html>...<body>static shell...</body></html>` or an html fragment with no close tags
			// search both cases to avoid duplicating the full string with toLowerCase
			const bodyClose = Math.max(
				prelude.lastIndexOf('</body>'),
				prelude.lastIndexOf('</BODY>'),
			)
			const htmlClose = Math.max(
				prelude.lastIndexOf('</html>'),
				prelude.lastIndexOf('</HTML>'),
			)
			// prefer inserting before </body>, then before </html>, and fall back
			// to appending when the prelude is only a fragment with no close tags
			const splitAt =
				bodyClose >= 0 ? bodyClose : htmlClose >= 0 ? htmlClose : prelude.length

			return new ReadableStream<Uint8Array>({
				async start(controller) {
					// send everything before the closing tags so the resume stream can be injected
					controller.enqueue(encoder.encode(prelude.slice(0, splitAt)))

					// resumeStream is the html React emits when it resumes postponed work for this page. Its
					// first chunk begins with an extra `</body></html>` pair, then continues with the
					// resumed scripts and markup for the unfinished work. Strip that leading
					// pair once, then pass the rest through unchanged
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
								// we already wrote the prelude up to the insertion point before its closing tags.
								// React's first resumed chunk starts with an extra `</body></html>` pair,
								// so strip that prefix and keep the rest of the chunk
								const trimmed = text.replace(/^\s*<\/body>\s*<\/html>/i, '')

								if (trimmed.length > 0) controller.enqueue(encoder.encode(trimmed))

								continue
							}

							// once the duplicated `</body></html>` prefix is removed, stop trying to
							// interpret the stream and forward each remaining chunk exactly as React
							// emitted it
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
		 */
		export function getTimeout() {
			const v = Number(process.env.SOLAS_PRERENDER_TIMEOUT_MS)

			if (!Number.isFinite(v) || v <= 0) {
				return DEFAULT_TIMEOUT_MS
			}

			return v
		}

		/**
		 * Get the prerender concurrency value from the environment variable, or return the default
		 * if it's not set or invalid
		 */
		export function getConcurrency() {
			const v = Number(process.env.SOLAS_PRERENDER_CONCURRENCY)

			if (!Number.isInteger(v) || v <= 0) {
				return DEFAULT_CONCURRENCY
			}

			return v
		}

		/**
		 * Extract the prerendering mode ('full', 'ppr', or false) from the source code of a route module, by
		 * looking for an exported `prerender` binding and validating its value
		 */
		export async function getStaticFlag(filePath: string, buildContext: BuildContext) {
			return buildContext.exportReader.literal<'full' | 'ppr' | false>(
				filePath,
				'prerender',
				(v): v is (typeof Solas.Config.PRERENDER_MODES)[number] =>
					v === 'full' || v === 'ppr' || v === false,
			)
		}

		/**
		 * Get the list of static parameters for a dynamic route, by looking for an exported `params` function
		 * in the route module and calling it to get the list of parameter objects
		 */
		export async function getStaticParams(filePath: string, buildContext: BuildContext) {
			const params = await buildContext.exportReader.value<
				() => Promise<unknown> | unknown
			>(
				filePath,
				'params',
				(v): v is () => Promise<unknown> | unknown => typeof v === 'function',
			)

			if (!params) return []

			const resolved = await Time.timeout(
				Promise.try(() => params()),
				getTimeout(),
				`static params for ${filePath}`,
			)

			if (!Array.isArray(resolved)) return []

			return resolved as Record<string, string | number | (string | number)[]>[]
		}

		/**
		 * Generate the list of prerenderable routes for a dynamic route, by combining the static parameters obtained from
		 * the route module with the route pattern, and filtering out any routes that still contain dynamic segments
		 */
		export function getDynamicRouteList(
			route: string,
			paramNames: string[],
			staticParams: Record<string, string | number | (string | number)[]>[],
		) {
			if (!staticParams.length) return []

			const { path: compilePath, wildcardNames } = toPathPattern(route, paramNames)
			const toPath = compile(compilePath)

			return staticParams
				.map(value => {
					try {
						return toPath(
							Object.fromEntries(
								Object.entries(value).map(([key, entry]) => [
									key,
									wildcardNames.has(key)
										? Array.isArray(entry)
											? entry.map(part => String(part))
											: [String(entry)]
										: Array.isArray(entry)
											? entry.map(part => String(part)).join('/')
											: String(entry),
								]),
							),
						)
					} catch {
						return null
					}
				})
				.filter((value): value is string => value !== null)
				.filter(r => !r.includes(':') && !r.includes('*'))
		}

		/**
		 * Function to prerender a single route by making a request to the route with special headers, and returning the
		 * result which includes either the prerender artifact or an error/status code if the prerendering failed or was
		 * postponed to request-time
		 */
		export async function get(
			app: { fetch: (req: Request) => Promise<Response> },
			route: string,
			opts: { timeout: number; origin?: string },
		) {
			const url = `${opts.origin ?? `http://${Solas.Config.SLUG}.local`}${route}`

			const res = await Time.timeout(
				app.fetch(
					new Request(url, {
						headers: {
							Accept: 'text/html',
							[`x-${Solas.Config.SLUG}-prerender`]: '1',
							[`x-${Solas.Config.SLUG}-prerender-artifact`]: '1',
						},
					}),
				),
				opts.timeout,
				`route ${route}`,
			)

			if (!(res instanceof Response)) {
				const error = new TypeError(`Invalid response for ${route}`)
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
