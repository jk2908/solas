import { use } from 'react'

import type { Metadata as Collection } from '../../shared/metadata'

export function Metadata({ metadata: m }: { metadata?: Promise<Collection.Item> }) {
	if (!m) return null

	// @todo; handle errors
	const metadata = use(m)

	return (
		<>
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
