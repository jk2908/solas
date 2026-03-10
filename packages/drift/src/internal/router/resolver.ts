import { lazy } from 'react'

import type {
	DynamicImport,
	ImportMap,
	Manifest,
	ManifestEntry,
	Primitive,
	View,
} from '../../types'

import { Logger } from '../../utils/logger'

import type { Router } from './router'
import { Build } from '../build'
import { Metadata } from '../metadata'
import { HttpException, isHttpException } from '../navigation/http-exception'

export namespace Resolver {
	export type ReconciledMatch = ReturnType<Resolver['reconcile']>

	export type EnhancedMatch = ReconciledMatch & {
		ui: {
			layouts: (View<{
				children?: React.ReactNode
				params?: Router.Params
			}> | null)[]
			Page: View<{
				children?: React.ReactNode
				params?: Router.Params
			}> | null
			'404s': (View<{
				children?: React.ReactNode
				error?: HttpException
			}> | null)[]
			loaders: (View<{
				children?: React.ReactNode
			}> | null)[]
		}
		error?: HttpException | Error
		endpoint?: (req?: Request & { params?: Router.Params }) => unknown
		metadata?: ({ params, error }: { params?: Router.Params; error?: Error }) => Promise<
			PromiseSettledResult<{
				task: Promise<Metadata.Item>
				priority: (typeof Metadata.PRIORITY)[keyof typeof Metadata.PRIORITY]
			}>[]
		>
	}
}

const logger = new Logger()
const IS_DEV = import.meta.env.DEV

/**
 * Resolve router matches against the application manifest and import map
 */
export class Resolver {
	/**
	 * Cache of enhanced matches
	 */
	static #enhancedMatchCache = new Map<string, Resolver.EnhancedMatch>()

	/**
	 * Cache of loaded modules from dynamic imports
	 */
	static #moduleCache = new WeakMap<
		DynamicImport,
		{
			/**
			 * The promise resolving to the module
			 */
			promise: Promise<Record<string, unknown>>
			/**
			 * The loaded module
			 */
			module?: Record<string, unknown>
			/**
			 * The (maybe lazy) React component loaded from the module
			 */
			Component?: View<React.ComponentProps<any>>
		}
	>()

	#manifest: Manifest = {}
	#importMap: ImportMap = {}

	/**
	 * @see {@link Manifest} for the structure of the manifest
	 * @see {@link ImportMap} for the structure of the import map
	 */
	constructor(manifest: Manifest, importMap: ImportMap) {
		this.#manifest = manifest
		this.#importMap = importMap
	}

	/**
	 * Narrow down a route entry to a page entry if it exists
	 */
	static narrow(entry?: ManifestEntry | ManifestEntry[]) {
		if (Array.isArray(entry)) {
			return entry.find(e => e.__kind === Build.EntryKind.PAGE) || null
		}

		return entry?.__kind === Build.EntryKind.PAGE ? entry : null
	}

	/**
	 * Get the status code for a matched route that may or may not have errored
	 */
	static getMatchStatusCode(
		match: Resolver.ReconciledMatch | Resolver.EnhancedMatch | null,
	) {
		if (!match) return 404

		if ('error' in match) {
			return match.error instanceof HttpException ? match.error.status : 500
		}

		return 200
	}

	/**
	 * Load and cache a module from a dynamic import
	 */
	static #load(loader: DynamicImport) {
		if (IS_DEV) {
			return {
				promise: loader(),
			}
		}

		let entry = Resolver.#moduleCache.get(loader)
		if (entry) return entry

		const promise = loader()
			.then(mod => {
				const entry = Resolver.#moduleCache.get(loader)
				if (entry) entry.module = mod

				return mod
			})
			.catch(err => {
				Resolver.#moduleCache.delete(loader)
				throw err
			})

		entry = { promise }
		Resolver.#moduleCache.set(loader, entry)

		return entry
	}

	/**
	 * Lazily load and cache a component from a dynamic import
	 */
	static #view<T extends React.ComponentType<any>>(
		loader: DynamicImport,
	): View<React.ComponentProps<T>> {
		const entry = Resolver.#load(loader)

		logger.debug(
			'[#view]',
			loader.toString().slice(0, 60),
			entry.module ? 'SYNC' : 'LAZY',
		)

		if (entry.module?.default) {
			entry.Component = entry.module.default as View<React.ComponentProps<T>>
			return entry.Component
		}

		if (entry.Component) return entry.Component as View<React.ComponentProps<T>>

		const Component = lazy(() =>
			entry.promise.then(mod => ({ default: mod.default as T })),
		)
		entry.Component = Component as View<React.ComponentProps<T>>

		return entry.Component
	}

	/**
	 * Reconcile a router match against a manifest entry
	 */
	reconcile(path: string, match: Router.Match | null, error?: Error) {
		if (match) {
			const entry = Resolver.narrow(this.#manifest[match.route.path])

			if (entry) {
				return {
					...entry,
					params: match.params,
					error,
				}
			}
		}

		// @note: if there's no match we'll traverse backwards
		// to find the closest user supplied 404 boundary
		const entry = this.closest(path, 'paths.404s')

		if (entry) {
			return {
				...entry,
				params: {},
				error:
					isHttpException(error) && error.status === 404
						? error
						: new HttpException(404, 'Not found'),
			}
		}

		return null
	}

	/**
	 * Enhance a matched route with its associated components
	 */
	enhance(match: Resolver.ReconciledMatch | null) {
		if (!match) return null

		const { __id } = match
		const cached = IS_DEV ? undefined : Resolver.#enhancedMatchCache.get(__id)

		if (cached) {
			logger.debug('[enhance]', __id, 'CACHED')

			// update params and error in case they changed as part
			// of a dynamic route navigation
			cached.params = match.params
			cached.error = 'error' in match ? match.error : undefined

			return cached
		}

		const entry = this.#importMap[__id]
		if (!entry) return null

		const enhanced: Resolver.EnhancedMatch = {
			ui: {
				layouts: [],
				Page: null,
				'404s': [],
				loaders: [],
			},
			...match,
		}

		// shell is a static import, layouts[0] in the enhanced match
		if (entry.shell) {
			enhanced.ui.layouts = [
				entry.shell.default as Resolver.EnhancedMatch['ui']['layouts'][0],
			]
		}

		if (entry.layouts?.length) {
			const dynamicLayouts = entry.layouts.map(l =>
				l
					? Resolver.#view<NonNullable<Resolver.EnhancedMatch['ui']['layouts'][number]>>(
							l,
						)
					: null,
			)
			enhanced.ui.layouts = [...enhanced.ui.layouts, ...dynamicLayouts]
		}

		if (entry.page) {
			enhanced.ui.Page = Resolver.#view<
				NonNullable<Resolver.EnhancedMatch['ui']['Page']>
			>(entry.page)
		}

		// load 404 boundaries
		if (entry['404s']?.length) {
			enhanced.ui['404s'] = entry['404s'].map(e =>
				e
					? Resolver.#view<NonNullable<Resolver.EnhancedMatch['ui']['404s'][number]>>(e)
					: null,
			)
		}

		// each route can display a loading component whilst layouts
		// are suspended - not inherited like other components
		if (entry.loaders?.length) {
			enhanced.ui.loaders = entry.loaders.map(l =>
				l
					? Resolver.#view<NonNullable<Resolver.EnhancedMatch['ui']['loaders'][number]>>(
							l,
						)
					: null,
			)
		}

		if (entry.endpoint) enhanced.endpoint = entry.endpoint

		enhanced.metadata = ({
			params,
			error,
		}: {
			params?: Router.Params
			error?: Error
		}) => {
			const tasks: { task: Promise<Metadata.Item>; priority: number }[] = []

			if (entry.shell) {
				const metadata = entry.shell.metadata

				if (metadata) {
					if (typeof metadata === 'function') {
						tasks.push({
							task: Promise.resolve(metadata({ params, error })).catch(err => {
								logger.error(`[enhance.metadata]: ${__id}`, err)
								return Promise.resolve({})
							}),
							priority: Metadata.PRIORITY[Build.EntryKind.SHELL],
						})
					} else if (typeof metadata === 'object') {
						tasks.push({
							task: Promise.resolve(metadata),
							priority: Metadata.PRIORITY[Build.EntryKind.SHELL],
						})
					}
				}
			}

			if (entry.layouts?.length) {
				for (const layout of entry.layouts) {
					if (!layout) continue

					const e = Resolver.#load(layout)

					if (e.module && 'metadata' in e.module) {
						const metadata = e.module.metadata

						if (metadata) {
							if (typeof metadata === 'function') {
								tasks.push({
									task: Promise.resolve(metadata({ params, error })).catch(err => {
										logger.error(`[enhance.metadata]: ${__id}`, err)
										return {}
									}),
									priority: Metadata.PRIORITY[Build.EntryKind.LAYOUT],
								})
							} else if (typeof metadata === 'object') {
								tasks.push({
									task: Promise.resolve(metadata),
									priority: Metadata.PRIORITY[Build.EntryKind.LAYOUT],
								})
							}
						}
					} else {
						tasks.push({
							task: e.promise.then(m => {
								const metadata = m.metadata
								if (!metadata) return {}

								if (typeof metadata === 'function') {
									return metadata({ params, error }).catch((err: unknown) => {
										logger.error(`[enhance.metadata]: ${__id}`, err)
										return {}
									})
								} else if (typeof metadata === 'object') {
									return metadata
								}
							}),
							priority: Metadata.PRIORITY[Build.EntryKind.LAYOUT],
						})
					}
				}
			}

			if (entry.page) {
				const e = Resolver.#load(entry.page)

				if (e.module && 'metadata' in e.module) {
					const metadata = e.module.metadata

					if (metadata) {
						if (typeof metadata === 'function') {
							tasks.push({
								task: Promise.resolve(metadata({ params, error })).catch(err => {
									logger.error(`[enhance.metadata]: ${__id}`, err)
									return {}
								}),
								priority: Metadata.PRIORITY[Build.EntryKind.PAGE],
							})
						} else if (typeof metadata === 'object') {
							tasks.push({
								task: Promise.resolve(metadata),
								priority: Metadata.PRIORITY[Build.EntryKind.PAGE],
							})
						}
					}
				} else {
					tasks.push({
						task: e.promise.then(m => {
							const metadata = m.metadata
							if (!metadata) return {}

							if (typeof metadata === 'function') {
								return metadata({ params, error }).catch((err: unknown) => {
									logger.error(`[enhance.metadata]: ${__id}`, err)
									return {}
								})
							} else if (typeof metadata === 'object') {
								return metadata
							}
						}),
						priority: Metadata.PRIORITY[Build.EntryKind.PAGE],
					})
				}
			}

			if (entry['404s'] && error) {
				for (const errLoader of entry['404s']) {
					if (!errLoader) continue
					const e = Resolver.#load(errLoader)

					if (e.module && 'metadata' in e.module) {
						const metadata = e.module.metadata

						if (metadata) {
							if (typeof metadata === 'function') {
								tasks.push({
									task: Promise.resolve(metadata({ params, error })).catch(err => {
										logger.error(`[enhance.metadata]: ${__id}`, err)
										return {}
									}),
									priority: Metadata.PRIORITY[Build.EntryKind['404']],
								})
							} else if (typeof metadata === 'object') {
								tasks.push({
									task: Promise.resolve(metadata),
									priority: Metadata.PRIORITY[Build.EntryKind['404']],
								})
							}
						}
					} else {
						tasks.push({
							task: e.promise.then(m => {
								const metadata = m.metadata
								if (!metadata) return {}

								if (typeof metadata === 'function') {
									return metadata({ params, error }).catch((err: unknown) => {
										logger.error(`[enhance.metadata]: ${__id}`, err)
										return {}
									})
								} else if (typeof metadata === 'object') {
									return metadata
								}
							}),
							priority: Metadata.PRIORITY[Build.EntryKind['404']],
						})
					}
				}
			}

			return Promise.allSettled(tasks)
		}

		if (!IS_DEV) Resolver.#enhancedMatchCache.set(__id, enhanced)

		return enhanced
	}

	/**
	 * Find the closest ancestor entry for a given path and property
	 */
	closest(path: string, property: string, value?: Omit<Primitive, 'undefined'>) {
		const parts = path.split('/').filter(Boolean)
		const segments = property.split('.')

		for (let i = parts.length; i >= 0; i--) {
			const testPath = i === 0 ? '/' : `/${parts.slice(0, i).join('/')}`
			const entry = this.#manifest[testPath]
			if (!entry) continue

			const pageEntry = Resolver.narrow(entry)
			if (!pageEntry) continue

			let curr: unknown = pageEntry

			for (const segment of segments) {
				if (!curr || typeof curr !== 'object') break
				if (!(segment in curr)) break

				curr = (curr as Record<string, unknown>)[segment]
			}

			if (curr === undefined) continue
			if (value && curr !== value) continue

			return pageEntry
		}

		return null
	}
}
