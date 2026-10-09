import type { Assets } from './internal/runtimes/assets.js'
import * as Config from './config.js'
import * as Prerender from './internal/prerender.js'
import { nodeAssets } from './internal/runtimes/assets.js'

export type Manifest = {
	artifacts: Prerender.ArtifactManifest
	publicFiles: ReadonlySet<string>
}

export function getManifestPath(outDir: string) {
	return [outDir, Config.GENERATED_DIR, Config.RUNTIME_MANIFEST]
		.map((part, index) => {
			const normalised = part.replace(/\\/g, '/').replace(/\/+/g, '/')

			if (index === 0) return normalised.replace(/\/+$/, '')
			return normalised.replace(/^\/+/, '').replace(/\/+$/, '')
		})
		.join('/')
}

export async function loadManifest(
	assets: Assets = nodeAssets,
): Promise<Manifest | null> {
	const asset = { namespace: 'artifact', path: Config.RUNTIME_MANIFEST } as const

	if (!(await assets.exists(asset))) return null

	try {
		const value = JSON.parse(await assets.readText(asset))

		if (!isRecord(value)) return null

		const artifacts = value.artifacts ?? value.routes
		const publicFiles = value.publicFiles

		if (!isRecord(artifacts)) return null
		if (publicFiles !== undefined && !Array.isArray(publicFiles)) return null

		for (const entry of Object.values(artifacts)) {
			if (!isRecord(entry)) return null

			const { mode, files } = entry

			if (mode !== 'full' && mode !== 'ppr') return null

			if (files !== undefined) {
				if (!Array.isArray(files)) return null

				for (const file of files) {
					if (
						file !== 'html' &&
						file !== 'prelude' &&
						file !== 'postponed' &&
						file !== 'metadata'
					) {
						return null
					}
				}
			}
		}

		for (const entry of publicFiles ?? []) {
			if (typeof entry !== 'string' || !entry.startsWith('/')) return null
		}

		return {
			artifacts: artifacts as Manifest['artifacts'],
			publicFiles: new Set((publicFiles as string[] | undefined) ?? []),
		}
	} catch {
		return null
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}
