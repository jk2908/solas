import path from 'node:path'

import type { BuildContext } from '../types'

import { Drift } from '../drift'

import { Time } from '../utils/time'

export namespace Prerender {
	const DEFAULT_TIMEOUT_MS = 15_000
	const DEFAULT_CONCURRENCY = 4

	/**
	 * Get the timeout for prerendering a single route in milliseconds.
	 * @description this can be configured via the DRIFT_PRERENDER_TIMEOUT_MS environment variable. If the value is not a positive number, a default of 15000ms (15 seconds) will be used
	 * @returns the timeout in milliseconds
	 */
	export function getTimeout() {
		const v = Number(process.env.DRIFT_PRERENDER_TIMEOUT_MS)

		if (!Number.isFinite(v) || v <= 0) {
			return DEFAULT_TIMEOUT_MS
		}

		return v
	}

	/**
	 * Get the maximum number of concurrent prerender requests to make when running Prerender.run
	 * @description this can be configured via the DRIFT_PRERENDER_CONCURRENCY environment variable.
	 * If the value is not a positive integer, a default of 4 will be used
	 * @returns the concurrency limit as a number
	 */
	export function getConcurrency() {
		const v = Number(process.env.DRIFT_PRERENDER_CONCURRENCY)

		if (!Number.isInteger(v) || v <= 0) {
			return DEFAULT_CONCURRENCY
		}

		return v
	}

	export type Result =
		| { route: string; artifact: Artifact }
		| { route: string; status: number }
		| { route: string; error: unknown }

	export type Artifact = {
		schema: string
		route: string
		createdAt: number
		mode: 'full' | 'ppr'
		html: string
		postponed?: unknown
	}

	export type ArtifactMetadata = Pick<Artifact, 'schema' | 'route' | 'createdAt' | 'mode'>

	/**
	 * Marker error used to intentionally abort prerender work and
	 * force unresolved sections into postponed state
	 */
	export class Postponed extends Error {
		constructor(message: string = 'postponed') {
			super(message)
			this.name = 'Postponed'
		}
	}

	/**
	 * Check if an error came from intentional prerender postponing
	 * @param error - unknown error value
	 * @returns true when error is a known postpone signal
	 */
	export function isPostponed(error: unknown) {
		if (error instanceof Postponed) return true

		if (
			error instanceof Error &&
			(error.name === 'AbortError' || error.name === 'TimeoutError')
		) {
			const cause = (error as Error & { cause?: unknown }).cause
			if (cause instanceof Postponed) return true
		}

		return false
	}

	/**
	 * Convert a route pathname to a stable artifact key
	 * @param pathname - route pathname
	 * @returns normalised key
	 */
	function toRouteDir(pathname: string) {
		if (pathname === '/') return 'index'

		return pathname.replace(/^\//, '')
	}

	/**
	 * Get the artifact directory for a route
	 * @param outDir - output directory
	 * @param pathname - route pathname
	 * @returns artifact directory path
	 */
	export function getArtifactPath(outDir: string, pathname: string) {
		return path.join(outDir, Drift.Config.GENERATED_DIR, 'ppr', toRouteDir(pathname))
	}

	/**
	 * Load postponed state generated at build time for a route
	 * @param outDir - output directory
	 * @param pathname - route pathname
	 * @returns parsed postponed state, or null
	 */
	export async function loadPostponedState(outDir: string, pathname: string) {
		const file = Bun.file(path.join(getArtifactPath(outDir, pathname), 'postponed.json'))
		if (!(await file.exists())) return null

		try {
			return JSON.parse(await file.text())
		} catch {
			return null
		}
	}

	/**
	 * Load prelude HTML generated at build time for a route
	 * @param outDir - output directory
	 * @param pathname - route pathname
	 * @returns prelude html, or null
	 */
	export async function loadPrelude(outDir: string, pathname: string) {
		const file = Bun.file(path.join(getArtifactPath(outDir, pathname), 'prelude.html'))
		if (!(await file.exists())) return null

		try {
			return await file.text()
		} catch {
			return null
		}
	}

	/**
	 * Load prerender artifact metadata generated at build time for a route
	 * @param outDir - output directory
	 * @param pathname - route pathname
	 * @returns parsed metadata, or null
	 */
	export async function loadArtifactMetadata(outDir: string, pathname: string) {
		const file = Bun.file(path.join(getArtifactPath(outDir, pathname), 'metadata.json'))
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

			return { schema, route, createdAt, mode } satisfies ArtifactMetadata
		} catch {
			return null
		}
	}

	/**
	 * Validate artifact metadata against expected route/mode and current Drift schema
	 * @param metadata - parsed artifact metadata
	 * @param pathname - expected route pathname
	 * @param mode - expected prerender mode
	 * @returns true when metadata is compatible
	 */
	export function isArtifactCompatible(
		artifactMetadata: ArtifactMetadata,
		pathname: string,
		mode: Artifact['mode'],
	) {
		const schema = Drift.getVersion()

		return (
			artifactMetadata.schema === schema &&
			artifactMetadata.route === pathname &&
			artifactMetadata.mode === mode
		)
	}

	/**
	 * Compose ppr html response by streaming prelude first then resume chunks
	 * @param prelude - prerendered html shell
	 * @param resumeStream - request-time resume stream
	 * @returns composed html stream
	 */
	export function composePreludeAndResume(
		prelude: string,
		resumeStream: ReadableStream<Uint8Array>,
	) {
		// find the final document close so we can insert resume output
		// before </body></html> rather than after a fully closed doc
		const lower = prelude.toLowerCase()
		const bodyClose = lower.lastIndexOf('</body>')
		const htmlClose = lower.lastIndexOf('</html>')
		const splitAt = bodyClose >= 0 && htmlClose > bodyClose ? bodyClose : prelude.length

		return new ReadableStream<Uint8Array>({
			async start(controller) {
				// reuse encoders for converting between streamed bytes and text
				const encoder = new TextEncoder()
				const decoder = new TextDecoder()

				// emit the prelude up to (but not including) the closing tags
				// so resume content lands inside the same document
				controller.enqueue(new TextEncoder().encode(prelude.slice(0, splitAt)))

				const reader = resumeStream.getReader()
				// React.resume may start with </body></html> because it assumes
				// ownership of the whole document - strip once when present
				let strippedLeadingClose = false

				try {
					while (true) {
						const { value, done } = await reader.read()

						if (done) break
						if (!value) continue

						if (!strippedLeadingClose) {
							strippedLeadingClose = true

							// decode first chunk as text so we can remove leading closes
							const text = decoder.decode(value)
							const trimmed = text.replace(/^\s*<\/body>\s*<\/html>/i, '')

							// only re-enqueue when something remains after trimming
							if (trimmed.length > 0) controller.enqueue(encoder.encode(trimmed))

							continue
						}

						// forward all remaining resume bytes unchanged
						controller.enqueue(value)
					}
				} finally {
					// release resources and finish the composite stream
					reader.releaseLock()
					controller.close()
				}
			},
		})
	}

	/**
	 * Read a route file's prerender export
	 * @param filePath - file path to check
	 * @returns explicit mode when exported, undefined otherwise
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

	/**
	 * Request a prerender artifact for a single route
	 * @param app - object with fetch method for making requests to the app server
	 * @param route - route pathname to prerender
	 * @param opts - options including timeout and optional origin override
	 * @returns prerender result with either artifact or error/status
	 * @throws when the request fails or returns invalid data
	 */
	export async function route(
		app: { fetch: (req: Request) => Promise<Response> },
		route: string,
		opts: { timeout: number; origin?: string },
	) {
		// build an internal url for this route. origin is overridable for testing
		// or custom adapters, and defaults to drift local origin
		const url = `${opts.origin ?? 'http://drift.local'}${route}`

		// ask the app for prerender output and enforce a timeout so one slow route
		// does not block the full prerender pipeline
		const res = await Time.withTimeout(
			app.fetch(
				new Request(url, {
					// request html and tell the app to return prerender artifact payload
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

		// app.fetch should always resolve to a Response
		if (!(res instanceof Response)) {
			throw new Error(`invalid prerender response for ${route}`)
		}

		// non-2xx means skip writing artifacts for this route
		if (!res.ok) return { route, status: res.status } satisfies Result

		// parse and return the prerender artifact payload
		const artifact = (await res.json()) as Artifact

		return { route, artifact } satisfies Result
	}

	/**
	 * Concurrent prerender result stream
	 * @param app - object with fetch method for making requests to the app server
	 * @param routes - array of route pathnames to prerender
	 * @param opts - options including timeout, concurrency limit, and optional origin override
	 * @returns async generator yielding prerender results as they complete
	 * @throws when a prerender request fails or returns invalid data
	 */
	export async function* run(
		app: { fetch: (req: Request) => Promise<Response> },
		routes: string[],
		opts: { timeout: number; concurrency?: number; origin?: string },
	) {
		// decide how many routes can run at once
		// - minimum 1 so we always make progress
		// - maximum route count so we never over-schedule
		const limit = Math.max(1, Math.min(opts.concurrency ?? 4, routes.length || 1))

		// points to the next route that has not been queued yet
		let index = 0

		// stores active prerender promises keyed by their queue index. We
		// keep the index so we can remove the exact task that settles
		const pending = new Map<
			number,
			Promise<{
				index: number
				result: Result
			}>
		>()

		function enqueue() {
			// fill available worker slots until we hit the concurrency limit
			// or until every route has been queued
			while (index < routes.length && pending.size < limit) {
				const i = index++
				const value = routes[i]

				// start prerendering this route now. Always return a Result shape
				// so callers can handle success and errors uniformly
				pending.set(
					i,
					Prerender.route(app, value, {
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

		// prime the first batch of work
		enqueue()

		// stream results as tasks finish (completion order, not route order)
		while (pending.size > 0) {
			// wait for at least one prerender to finish so we can yield its
			// result and free up its slot in the active work set
			const settled = await Promise.race(pending.values())

			// remove the finished task from active work
			pending.delete(settled.index)

			// yield one completed prerender result to the caller
			yield settled.result

			// keep throughput steady by scheduling the next route immediately
			enqueue()
		}
	}
}
