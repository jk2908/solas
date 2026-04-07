import { lazy } from 'react'

import type {
	DynamicImport,
	ImportMap,
	Manifest,
	ManifestEntry,
	Primitive,
	View,
} from '../../types.js'

import { Logger } from '../../utils/logger.js'

import type { Router } from './router.js'
import { Build } from '../build.js'
import { Metadata } from '../metadata.js'
import { HttpException, isHttpException } from '../navigation/http-exception.js'

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

	/**
	 * Find a manifest entry by path, trying both with and without a trailing slash
	 */
	static #getEntryByPath(manifest: Manifest, path: string) {
		const direct = manifest[path]
		if (direct) return direct

		if (path !== '/' && path.endsWith('/')) {
			return manifest[path.slice(0, -1)]
		}

		return manifest[`${path}/`]
	}

	/**
	 * Merge the cached enhanced match with the params and error from this request's match
	 */
	static #withRequestState(
		cached: Resolver.CachedEnhancedMatch,
		match: NonNullable<Resolver.ReconciledMatch>,
	) {
		// the cached match only stores route structure, while params and errors
		// still belong to this request so merge them back in here
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
			// in dev always call the loader directly so hot updates are not hidden
			// behind the prod cache
			return {
				promise: loader(),
			}
		}

		let entry = Resolver.#moduleCache.get(loader)
		if (entry) return entry

		// cache the in-flight import so repeated lookups share one load
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
	static #view<T extends React.ComponentType<any>>(loader: DynamicImport) {
		const entry = Resolver.#load(loader)

		logger.debug(
			'[#view]',
			loader.toString().slice(0, 60),
			entry.module ? 'SYNC' : 'LAZY',
		)

		if (entry.module?.default) {
			// if the module already loaded, return the component directly
			entry.Component = entry.module.default as View<React.ComponentProps<T>>
			return entry.Component
		}

		// if we already created a lazy wrapper for this module
		// reuse it
		if (entry.Component) return entry.Component as View<React.ComponentProps<T>>

		// otherwise create the lazy wrapper once and keep it on the cache entry
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
			const entry = Resolver.narrow(
				Resolver.#getEntryByPath(this.#manifest, match.route.path),
			)

			if (entry) {
				// normal case, the router matched a page route so just attach request state
				return {
					...entry,
					params: match.params,
					error,
				}
			}
		}

		// if nothing matched directly, walk back up the path
		// and look for the nearest user 404 boundary
		const entry = this.closest(path, 'paths.404s')

		if (entry) {
			// reuse that route entry but force it into a 404 state
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
		// if in dev skip the cache to always get the latest changes
		// and not break hmr
		const cached = IS_DEV ? undefined : Resolver.#enhancedMatchCache.get(__id)

		if (cached) {
			logger.debug('[enhance]', __id, 'CACHED')
			// cached ui can be reused, but params and errors still come from
			// this request
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

		// build the renderable ui shape from the import map, with a static shell
		// and dynamic imports for everything else
		if (entry.shell) {
			enhanced.ui.layouts = [
				entry.shell.default as Resolver.EnhancedMatch['ui']['layouts'][0],
			]
		}

		if (entry.layouts?.length) {
			// layouts are stored after the shell and can each load lazily
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
			// the page is the leaf view for this route
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

		// loading components are per route level they are not inherited like layouts
		// or boundaries
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

		// collect metadata loaders once per route so they can turn into request
		// specific tasks later when params and errors are known
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
			// metadata execution still happens per request because params and errors
			// can differ
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

		// walk from the current path back towards the root until we find a match
		for (let i = parts.length; i >= 0; i--) {
			const testPath = i === 0 ? '/' : `/${parts.slice(0, i).join('/')}`
			const entry = this.#manifest[testPath]
			if (!entry) continue

			const pageEntry = Resolver.narrow(entry)
			if (!pageEntry) continue

			let curr: unknown = pageEntry

			// follow the dotted property path step by step on the matched entry
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
