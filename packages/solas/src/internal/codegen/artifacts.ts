import type { Manifest, ManifestEntry, Segment } from '../../types.js'
import { Solas } from '../../solas.js'
import { Prerender } from '../prerender.js'
import { AUTOGEN_MSG, source, toSourceLiteral } from './utils.js'

function isSegment(entry: ManifestEntry): entry is Segment {
	return 'paths' in entry
}

function getPrerenderSegment(entry: Manifest[keyof Manifest]) {
	const entries = Array.isArray(entry) ? entry : [entry]

	return entries.find(isSegment) ?? null
}

/**
 * Generates the code to create an exported prerender artifact manifest object
 */
export function writeArtifactManifest(manifest: Manifest) {
	const artifactManifest: Prerender.Artifact.Manifest = Object.entries(
		manifest,
	).reduce<Prerender.Artifact.Manifest>((acc, [route, entry]) => {
		const segment = getPrerenderSegment(entry)

		if (!segment || !segment.prerender) return acc

		acc[route] =
			segment.prerender === 'full'
				? {
						mode: 'full',
					}
				: {
						mode: 'ppr',
					}

		return acc
	}, {})

	return source`
		${AUTOGEN_MSG}

		import type { Prerender } from '${Solas.Config.PKG_NAME}/prerender'

		export const artifactManifest = ${toSourceLiteral(artifactManifest)} as const satisfies Prerender.Artifact.Manifest
	`
}
