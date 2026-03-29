import { use } from 'react'

import { Solas } from '../../solas'

import { Logger } from '../../utils/logger'

import { type Metadata as Collection } from '../metadata'

const logger = new Logger()
const cache = new WeakMap<object, Promise<Collection.Item>>()

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

			{metadata.title && <title>{metadata.title.toString()}</title>}

			{metadata.meta?.map(meta => {
				if ('charSet' in meta) {
					return <meta key={meta.charSet} charSet={meta.charSet} />
				}

				if ('name' in meta) {
					return (
						<meta key={meta.name} name={meta.name} content={meta.content?.toString()} />
					)
				}

				if ('httpEquiv' in meta) {
					return (
						<meta
							key={meta.httpEquiv}
							httpEquiv={meta.httpEquiv}
							content={meta.content?.toString()}
						/>
					)
				}

				if ('property' in meta) {
					return (
						<meta
							key={meta.property}
							property={meta.property}
							content={meta.content?.toString()}
						/>
					)
				}

				return null
			})}

			{metadata.link?.map(link => (
				<link key={`${link.rel}${link.href ?? ''}`} {...link} />
			))}
		</>
	)
}

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
