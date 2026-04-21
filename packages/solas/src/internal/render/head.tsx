import { use } from 'react'

import { Logger } from '../../utils/logger.js'

import { Solas } from '../../solas.js'
import { type Metadata as Collection } from '../metadata.js'

const logger = new Logger()
const cache = new WeakMap<object, Promise<Collection.Item>>()

/**
 * Convert supported metadata primitives to string for meta tag content
 */
function toContent(value: unknown) {
	return typeof value === 'string' ||
		typeof value === 'number' ||
		typeof value === 'boolean'
		? String(value)
		: undefined
}

/**
 * Convert a metadata item or promise of an item to a promise that always resolves
 * successfully, caching the result for future use
 */
function toSafeUsable(metadata: Collection.Item | Promise<Collection.Item>) {
	const cached = cache.get(metadata)
	if (cached) return cached

	const safe = Promise.resolve(metadata).catch(err => {
		logger.error('[head] failed to resolve metadata', err)
		return {} as Collection.Item
	})

	cache.set(metadata, safe)
	return safe
}

/**
 * Renders title, meta, and link tags based on the provided metadata payload
 */
export function Head({
	metadata: m,
}: {
	metadata?: Collection.Item | Promise<Collection.Item>
}) {
	if (!m) return null
	const metadata = use(toSafeUsable(m))

	return (
		<>
			<meta name="generator" content={Solas.Config.NAME} />

			{toContent(metadata.title) !== undefined && (
				<title>{toContent(metadata.title)}</title>
			)}

			{metadata.meta?.map(meta => {
				if ('charSet' in meta) {
					return <meta key={meta.charSet} charSet={meta.charSet} />
				}

				if ('name' in meta) {
					return (
						<meta key={meta.name} name={meta.name} content={toContent(meta.content)} />
					)
				}

				if ('httpEquiv' in meta) {
					return (
						<meta
							key={meta.httpEquiv}
							httpEquiv={meta.httpEquiv}
							content={toContent(meta.content)}
						/>
					)
				}

				if ('property' in meta) {
					return (
						<meta
							key={meta.property}
							property={meta.property}
							content={toContent(meta.content)}
						/>
					)
				}

				return null
			})}

			{metadata.link?.map(link => (
				<link
					key={`${link.rel}${link.href ?? ''}`}
					rel={link.rel}
					href={typeof link.href === 'string' ? link.href : undefined}
					as={typeof link.as === 'string' ? link.as : undefined}
					type={typeof link.type === 'string' ? link.type : undefined}
					media={typeof link.media === 'string' ? link.media : undefined}
					sizes={typeof link.sizes === 'string' ? link.sizes : undefined}
					crossOrigin={
						link.crossOrigin === 'anonymous' || link.crossOrigin === 'use-credentials'
							? link.crossOrigin
							: undefined
					}
				/>
			))}
		</>
	)
}
