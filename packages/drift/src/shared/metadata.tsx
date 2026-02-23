import { Build } from '../build'

type EntryKind = typeof Build.EntryKind

const TITLE_TEMPLATE_STR = '%s'

export namespace Metadata {
	type Source = Exclude<
		EntryKind[keyof EntryKind],
		typeof Build.EntryKind.ENDPOINT | typeof Build.EntryKind.MIDDLEWARE
	>

	export const PRIORITY: Record<Source, number> = {
		[Build.EntryKind.SHELL]: 10,
		[Build.EntryKind.LAYOUT]: 20,
		[Build.EntryKind.PAGE]: 30,
		[Build.EntryKind['404']]: 40,
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
		#collection: {
			priority: number
			item: Promise<Item>
		}[] = []

		constructor(base?: Item) {
			if (base) this.#base = base
		}

		/**
		 * Merges multiple metadata objects into one
		 * @param items - an array of metadata objects to merge
		 * @returns the merged metadata object
		 */
		static #merge(...items: Item[]) {
			if (!items.length) return {} satisfies Item

			let titleTemplate: string | undefined
			let title: string | undefined

			const metaMap = new Map<string, MetaTag>()
			const linkMap = new Map<string, LinkTag>()

			for (const item of items) {
				if (item.title) {
					const titleStr = item.title.toString()

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
		 * @param obj - the object to clone
		 * @returns a clone of the object
		 */
		static #clone<T>(obj: T) {
			if (typeof structuredClone === 'function') {
				return structuredClone(obj) as T
			}

			return JSON.parse(JSON.stringify(obj)) as T
		}

		/**
		 * Gets a unique key for the meta tag
		 * @param tag - the meta tag
		 * @returns a unique key for the meta tag
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
		 * @param tag - the link tag
		 * @returns a unique key for the link tag
		 */
		static #getLinkTagKey(tag: LinkTag) {
			return tag.rel + (tag.href ?? '')
		}

		/**
		 * Adds tasks to the collection
		 * @param tasks - an array of task objects containing a promise and a priority
		 * @returns this
		 */
		add(
			...tasks: {
				task: Promise<Item>
				priority: number
			}[]
		) {
			for (const { task, priority } of tasks) {
				this.#collection.push({ priority, item: task })
			}

			return this
		}

		/**
		 * Merges metadata from all sources, sorted by priority
		 * @returns a promise that resolves to the merged metadata
		 */
		async run() {
			const items = [...this.#collection].sort((a, b) => a.priority - b.priority)
			let merged = Collection.#clone(this.#base)

			if (items.length === 0) return merged

			const tasks = items.map(entry =>
				entry.item
					.then(item => ({ item, priority: entry.priority }))
					.catch(() => ({ item: {}, priority: entry.priority })),
			)

			const res = await Promise.allSettled(tasks)
			const ok = res
				.filter(r => r.status === 'fulfilled')
				.map(r => r.value)
				.sort((a, b) => a.priority - b.priority)
				.map(r => r.item)

			if (ok.length) merged = Collection.#merge(merged, ...ok)

			return merged
		}

		/**
		 * @returns a clone of the base metadata
		 */
		get base() {
			return Collection.#clone(this.#base)
		}
	}
}
