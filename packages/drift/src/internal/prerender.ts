import path from 'node:path'

import type { BuildContext } from '../types'

import { Config } from '../config'

export namespace Prerender {
	export type Artifact = {
		mode: 'full' | 'ppr'
		html: string
		postponed?: unknown
	}

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
		return path.join(outDir, Config.GENERATED_DIR, 'ppr', toRouteDir(pathname))
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
}
