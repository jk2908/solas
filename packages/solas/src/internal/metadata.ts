import type { HttpException } from './navigation/http-exception'
import { Build } from './build'
import { isHttpException } from './navigation/http-exception'

type EntryKind = typeof Build.EntryKind

const TITLE_TEMPLATE_STR = '%s'

export namespace Metadata {
	type EntrySource = Exclude<
		EntryKind[keyof EntryKind],
		typeof Build.EntryKind.ENDPOINT | typeof Build.EntryKind.MIDDLEWARE
	>

	export const PRIORITY: Record<EntrySource, number> = {
		[Build.EntryKind.SHELL]: 10,
		[Build.EntryKind.LAYOUT]: 20,
		[Build.EntryKind.PAGE]: 30,
		[Build.EntryKind['401']]: 40,
		[Build.EntryKind['403']]: 40,
		[Build.EntryKind['404']]: 40,
		[Build.EntryKind['500']]: 40,
		[Build.EntryKind.LOADING]: 50,
	} as const

	type TagValue = string | number | boolean | undefined

	export type MetaTag =
		| { charSet: string }
		| { name: string; content: TagValue }
		| { httpEquiv: string; content: TagValue }
		| { property: string; content: TagValue }

	export type LinkTag = {
		rel: string
		href?: string
		as?: string
		type?: string
		media?: string
		sizes?: string
		crossOrigin?: 'anonymous' | 'use-credentials'
	}

	export type Item = {
		title?: TagValue
		meta?: MetaTag[]
		link?: LinkTag[]
	}

	export type Input<TParams = unknown, TError = Error> = {
		params?: TParams
		error?: TError
	}

	export type Task = {
		priority: number
		task: Promise<Item>
	}

	export type RunMode = 'always' | 'error'

	/**
	 * Check whether a value is a supported metadata primitive
	 */
	function isTagValue(value: unknown): value is Exclude<TagValue, 'undefined'> {
		return (
			typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
		)
	}

	/**
	 * Convert supported metadata primitives to string for title handling
	 */
	function toTitleString(value: unknown) {
		return isTagValue(value) ? String(value) : undefined
	}

	/**
	 * A cached way to load one metadata export for a route.
	 * The export itself is loaded once route structure is known, then resolved
	 * later with request-specific input such as params or an error.
	 */
	export type Source = {
		priority: Task['priority']
		when?: RunMode
		status?: HttpException.StatusCode
		load: () => Promise<unknown>
	}

	export class Collection {
		/**
		 * The base metadata object
		 * @description - normally extends config.metadata
		 */
		#base: Item = {}

		/**
		 * The collection of metadata tasks with their priorities
		 * @description - each task is a promise that resolves to a metadata object
		 */
		#collection: Task[] = []

		constructor(base?: Item) {
			if (base) this.#base = base
		}

		/**
		 * Merges multiple metadata objects into one
		 */
		static #merge(...items: Item[]) {
			if (!items.length) return {} satisfies Item

			let titleTemplate: string | undefined
			let title: string | undefined

			const metaMap = new Map<string, MetaTag>()
			const linkMap = new Map<string, LinkTag>()

			for (const item of items) {
				const titleStr = toTitleString(item.title)

				if (titleStr !== undefined) {
					if (titleStr.includes(TITLE_TEMPLATE_STR)) {
						titleTemplate = titleStr
					} else {
						title = titleStr
					}
				}

				if (item.meta) {
					for (const tag of item.meta) {
						metaMap.set(Collection.#getMetaTagKey(tag), tag)
					}
				}

				if (item.link) {
					for (const tag of item.link) {
						linkMap.set(Collection.#getLinkTagKey(tag), tag)
					}
				}
			}

			const metadata: Item = {}

			// build final title
			if (titleTemplate && title) {
				metadata.title = titleTemplate.replace(TITLE_TEMPLATE_STR, title)
			} else {
				metadata.title = title ?? titleTemplate?.replace(TITLE_TEMPLATE_STR, '').trim()
			}

			// assign final tags
			metadata.meta = [...metaMap.values()]
			metadata.link = [...linkMap.values()]

			return metadata
		}

		/**
		 * Clones an object using structuredClone w/ JSON fallback
		 */
		static #clone<T>(obj: T) {
			if (typeof structuredClone === 'function') {
				return structuredClone(obj) as T
			}

			return JSON.parse(JSON.stringify(obj)) as T
		}

		/**
		 * Gets a unique key for the meta tag
		 */
		static #getMetaTagKey(tag: MetaTag) {
			return 'name' in tag && tag.name
				? `name:${tag.name}`
				: 'property' in tag && tag.property
					? `property:${tag.property}`
					: 'httpEquiv' in tag && tag.httpEquiv
						? `httpEquiv:${tag.httpEquiv}`
						: 'charSet' in tag && tag.charSet
							? 'charSet'
							: JSON.stringify(tag)
		}

		/**
		 * Gets a unique key for the link tag
		 */
		static #getLinkTagKey(tag: LinkTag) {
			return tag.rel + (tag.href ?? '')
		}

		/**
		 * Adds tasks to the collection
		 */
		add(...tasks: Task[]) {
			for (const { task, priority } of tasks) {
				this.#collection.push({ priority, task })
			}

			return this
		}

		/**
		 * Merges metadata from all sources, sorted by priority
		 */
		async run() {
			const items = [...this.#collection].sort((a, b) => a.priority - b.priority)

			if (items.length === 0) return Collection.#clone(this.#base)

			let merged = Collection.#clone(this.#base)

			const res = await Promise.allSettled(items.map(item => item.task))
			const ok = res
				.filter(
					(result: PromiseSettledResult<Item>): result is PromiseFulfilledResult<Item> =>
						result.status === 'fulfilled',
				)
				.map((result: PromiseFulfilledResult<Item>) => result.value)

			if (ok.length) merged = Collection.#merge(merged, ...ok)

			return merged
		}

		/**
		 * Get a clone of the base metadata
		 */
		get base() {
			return Collection.#clone(this.#base)
		}
	}

	/**
	 * Normalise a metadata export into a promise of a metadata object
	 * Supports both plain object exports and metadata(input) functions
	 */
	export function resolve(
		metadata: unknown,
		input: Input,
		onError?: (err: unknown) => void,
	) {
		if (!metadata) return Promise.resolve({} satisfies Item)

		if (typeof metadata === 'function') {
			try {
				return Promise.resolve(metadata(input) as Item).catch(err => {
					onError?.(err)
					return {} satisfies Item
				})
			} catch (err) {
				onError?.(err)
				return Promise.resolve({} satisfies Item)
			}
		}

		if (typeof metadata === 'object') return Promise.resolve(metadata as Item)
		return Promise.resolve({} satisfies Item)
	}

	/**
	 * Turn cached metadata exports into concrete work for the current request/render
	 */
	export function tasks(
		sources: Source[],
		input: Input,
		onError?: (err: unknown) => void,
	) {
		const tasks: Task[] = []

		for (const source of sources) {
			if (source.when === 'error' && !input.error) continue
			if (source.status !== undefined) {
				if (
					!input.error ||
					!isHttpException(input.error) ||
					input.error.status !== source.status
				) {
					continue
				}
			}

			tasks.push({
				task: source.load().then(metadata => resolve(metadata, input, onError)),
				priority: source.priority,
			})
		}

		return tasks
	}
}
