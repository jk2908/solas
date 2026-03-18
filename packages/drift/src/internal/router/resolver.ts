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
	export type CachedEnhancedMatch = Omit<EnhancedMatch, 'params' | 'error'>

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
			'401s': (View<{
				children?: React.ReactNode
				error?: HttpException
			}> | null)[]
			'403s': (View<{
				children?: React.ReactNode
				error?: HttpException
			}> | null)[]
			'404s': (View<{
				children?: React.ReactNode
				error?: HttpException
			}> | null)[]
			'500s': (View<{
				children?: React.ReactNode
				error?: HttpException
			}> | null)[]
			loaders: (View<{
				children?: React.ReactNode
			}> | null)[]
		}
		error?: HttpException | Error
		endpoint?: (req?: Request & { params?: Router.Params }) => unknown
		metadata?: (input: Metadata.Input<Router.Params>) => Metadata.Task[]
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
	static #enhancedMatchCache = new Map<string, Resolver.CachedEnhancedMatch>()

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

	static #withRequestState(
		cached: Resolver.CachedEnhancedMatch,
		match: NonNullable<Resolver.ReconciledMatch>,
	) {
		return {
			...cached,
			params: match.params,
			error: match.error,
		} satisfies Resolver.EnhancedMatch
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
			// ensure request-specific state is merged back in to the cached enhanced match
			// (params/error)
			return Resolver.#withRequestState(cached, match)
		}

		const entry = this.#importMap[__id]
		if (!entry) return null

		const { params, error, ...rest } = match

		const enhanced: Resolver.CachedEnhancedMatch = {
			ui: {
				layouts: [],
				Page: null,
				'401s': [],
				'403s': [],
				'404s': [],
				'500s': [],
				loaders: [],
			},
			...rest,
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

		if (entry['401s']?.length) {
			enhanced.ui['401s'] = entry['401s'].map(e =>
				e
					? Resolver.#view<NonNullable<Resolver.EnhancedMatch['ui']['401s'][number]>>(e)
					: null,
			)
		}

		if (entry['403s']?.length) {
			enhanced.ui['403s'] = entry['403s'].map(e =>
				e
					? Resolver.#view<NonNullable<Resolver.EnhancedMatch['ui']['403s'][number]>>(e)
					: null,
			)
		}

		// load 404 boundaries
		if (entry['404s']?.length) {
			enhanced.ui['404s'] = entry['404s'].map(e =>
				e
					? Resolver.#view<NonNullable<Resolver.EnhancedMatch['ui']['404s'][number]>>(e)
					: null,
			)
		}

		if (entry['500s']?.length) {
			enhanced.ui['500s'] = entry['500s'].map(e =>
				e
					? Resolver.#view<NonNullable<Resolver.EnhancedMatch['ui']['500s'][number]>>(e)
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

		// cache the route's metadata exports once. They are turned into
		// request-specific tasks later with params/error
		const metadataSources: Metadata.Source[] = []

		if (entry.shell) {
			metadataSources.push({
				priority: Metadata.PRIORITY[Build.EntryKind.SHELL],
				load: () => Promise.resolve(entry.shell?.metadata),
			})
		}

		if (entry.layouts?.length) {
			for (const layout of entry.layouts) {
				if (!layout) continue
				const loaded = Resolver.#load(layout)

				metadataSources.push({
					priority: Metadata.PRIORITY[Build.EntryKind.LAYOUT],
					load: () =>
						loaded.module
							? Promise.resolve(loaded.module.metadata)
							: loaded.promise.then(module => module.metadata),
				})
			}
		}

		if (entry.page) {
			const loaded = Resolver.#load(entry.page)

			metadataSources.push({
				priority: Metadata.PRIORITY[Build.EntryKind.PAGE],
				load: () =>
					loaded.module
						? Promise.resolve(loaded.module.metadata)
						: loaded.promise.then(module => module.metadata),
			})
		}

		if (entry['401s']?.length) {
			for (const errLoader of entry['401s']) {
				if (!errLoader) continue
				const loaded = Resolver.#load(errLoader)

				metadataSources.push({
					priority: Metadata.PRIORITY[Build.EntryKind['401']],
					when: 'error',
					status: 401,
					load: () =>
						loaded.module
							? Promise.resolve(loaded.module.metadata)
							: loaded.promise.then(module => module.metadata),
				})
			}
		}

		if (entry['403s']?.length) {
			for (const errLoader of entry['403s']) {
				if (!errLoader) continue
				const loaded = Resolver.#load(errLoader)

				metadataSources.push({
					priority: Metadata.PRIORITY[Build.EntryKind['403']],
					when: 'error',
					status: 403,
					load: () =>
						loaded.module
							? Promise.resolve(loaded.module.metadata)
							: loaded.promise.then(module => module.metadata),
				})
			}
		}

		if (entry['404s']?.length) {
			for (const errLoader of entry['404s']) {
				if (!errLoader) continue
				const loaded = Resolver.#load(errLoader)

				metadataSources.push({
					priority: Metadata.PRIORITY[Build.EntryKind['404']],
					when: 'error',
					status: 404,
					load: () =>
						loaded.module
							? Promise.resolve(loaded.module.metadata)
							: loaded.promise.then(module => module.metadata),
				})
			}
		}

		if (entry['500s']?.length) {
			for (const errLoader of entry['500s']) {
				if (!errLoader) continue
				const loaded = Resolver.#load(errLoader)

				metadataSources.push({
					priority: Metadata.PRIORITY[Build.EntryKind['500']],
					when: 'error',
					status: 500,
					load: () =>
						loaded.module
							? Promise.resolve(loaded.module.metadata)
							: loaded.promise.then(module => module.metadata),
				})
			}
		}

		enhanced.metadata = ({ params, error }: Metadata.Input<Router.Params>) =>
			Metadata.tasks(metadataSources, { params, error }, err => {
				logger.error(`[enhance.metadata]: ${__id}`, err)
			})

		if (!IS_DEV) Resolver.#enhancedMatchCache.set(__id, enhanced)

		return {
			...enhanced,
			params,
			error,
		}
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
