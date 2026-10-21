import { isRecord, isStringArray } from './utils/validation.js'

import type { Assets } from './internal/assets.js'
import type { CspConfig } from './types.js'
import * as Config from './config.js'
import { nodeAssets } from './internal/assets.js'
import * as Prerender from './internal/prerender.js'

export type Manifest = {
	artifacts: Prerender.ArtifactManifest
	publicFiles: ReadonlySet<string>
	csp?: CspConfig
	trailingSlash?: (typeof Config.TRAILING_SLASH_MODES)[number]
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

export async function loadManifest(assets: Assets = nodeAssets) {
	const asset = { namespace: 'artifact', path: Config.RUNTIME_MANIFEST } as const

	if (!(await assets.exists(asset))) return null

	try {
		const value = JSON.parse(await assets.readText(asset))

		if (!isRecord(value)) return null

		const artifacts = value.artifacts ?? value.routes
		const publicFiles = value.publicFiles

		if (!isRecord(artifacts)) return null
		if (publicFiles !== undefined && !Array.isArray(publicFiles)) return null

		let trailingSlash: Manifest['trailingSlash']
		const rawTrailingSlash = value.trailingSlash

		if (rawTrailingSlash !== undefined) {
			if (
				rawTrailingSlash === 'always' ||
				rawTrailingSlash === 'never' ||
				rawTrailingSlash === 'ignore'
			) {
				trailingSlash = rawTrailingSlash
			} else {
				return null
			}
		}

		let cspConfig: CspConfig | undefined

		if (value.csp !== undefined) {
			if (!isRecord(value.csp)) return null
			if (!isRecord(value.csp.directives)) return null

			const directives: Record<string, string[]> = {}

			for (const [name, values] of Object.entries(value.csp.directives)) {
				if (!isStringArray(values)) return null

				directives[name] = values
			}

			cspConfig = { directives }
		}

		const parsedArtifacts: Prerender.ArtifactManifest = {}

		for (const [route, entry] of Object.entries(artifacts)) {
			if (!isRecord(entry)) return null

			const { mode, files, csp } = entry

			if (mode !== 'full' && mode !== 'ppr') return null

			const artifact: Prerender.Artifact = { mode }

			if (files !== undefined) {
				if (!Array.isArray(files)) return null

				const parsedFiles: Prerender.File[] = []

				for (const file of files) {
					if (!isArtifactFile(file)) return null

					parsedFiles.push(file)
				}

				artifact.files = parsedFiles
			}

			if (csp !== undefined) {
				if (!isRecord(csp)) return null
				if (!isStringArray(csp.script) || !isStringArray(csp.style)) return null

				artifact.csp = { script: csp.script, style: csp.style }
			}

			parsedArtifacts[route] = artifact
		}

		const parsedPublicFiles = new Set<string>()

		for (const file of publicFiles ?? []) {
			if (typeof file !== 'string' || !file.startsWith('/')) return null

			parsedPublicFiles.add(file)
		}

		return {
			artifacts: parsedArtifacts,
			publicFiles: parsedPublicFiles,
			csp: cspConfig,
			trailingSlash,
		}
	} catch {
		return null
	}
}

function isArtifactFile(value: unknown): value is Prerender.File {
	return (
		value === 'html' ||
		value === 'prelude' ||
		value === 'postponed' ||
		value === 'metadata'
	)
}
