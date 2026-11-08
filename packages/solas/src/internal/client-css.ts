import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import type { ViteDevServer } from 'vite'

import { getPluginApi } from '@vitejs/plugin-rsc'

import { normalisePath } from '../utils/path.js'
import { isRecord, isStringArray } from '../utils/validation.js'

import type { RoutePaths } from '../types.js'
import * as Config from '../config.js'

type AssetDeps = {
	js: string[]
	css: string[]
}

type RscAssetsManifest = {
	clientEntryDeps?: AssetDeps
	clientReferenceDeps?: Record<string, AssetDeps>
}

// validate each manifest entry before reading its asset arrays
function isAssetDeps(value: unknown): value is AssetDeps {
	return isRecord(value) && isStringArray(value.js) && isStringArray(value.css)
}

// accept only the optional fields with the expected dependency shape
function isRscAssetsManifest(value: unknown): value is RscAssetsManifest {
	if (!isRecord(value)) return false

	if (value.clientEntryDeps !== undefined && !isAssetDeps(value.clientEntryDeps)) {
		return false
	}

	if (value.clientReferenceDeps !== undefined) {
		if (!isRecord(value.clientReferenceDeps)) return false

		for (const deps of Object.values(value.clientReferenceDeps)) {
			if (!isAssetDeps(deps)) return false
		}
	}

	return true
}

/**
 * Stylesheets referenced by the client entry and client references in the
 * Vite RSC asset manifest.
 */
export type ClientCssManifest = {
	entry: string[]
	byReference: Record<string, string[]>
}

/**
 * Collect the stylesheets referenced by the client entry and every client
 * reference in the Vite RSC asset manifest.
 */
export async function loadClientCssManifest(outDir: string, rscDir?: string) {
	// the Vite RSC build emits this next to the RSC bundle
	const manifestPath = path.join(
		rscDir ?? path.join(outDir, 'rsc'),
		'__vite_rsc_assets_manifest.js',
	)

	let manifest: RscAssetsManifest

	// missing or malformed build output means there is no CSS to attach
	try {
		const mod: unknown = await import(/* @vite-ignore */ pathToFileURL(manifestPath).href)
		const value = isRecord(mod) ? mod.default : undefined

		if (!isRscAssetsManifest(value)) {
			return { entry: [], byReference: {} } satisfies ClientCssManifest
		}

		manifest = value
	} catch {
		return { entry: [], byReference: {} } satisfies ClientCssManifest
	}

	// the client bootstrap's css applies everywhere; component-boundary css is selected per route
	const entry = [...(manifest.clientEntryDeps?.css ?? [])]
	const byReference: Record<string, string[]> = {}

	// index references by key so route plans can resolve their CSS quickly
	for (const [reference, deps] of Object.entries(manifest.clientReferenceDeps ?? {})) {
		byReference[reference] = [...deps.css]
	}

	return { entry, byReference } satisfies ClientCssManifest
}

type BuildChunk = {
	type: 'chunk'
	fileName: string
	moduleIds: readonly string[]
	imports: readonly string[]
}

export type ClientReferenceMeta = {
	referenceKey: string
}

/**
 * Collect client reference keys from the RSC bundle for every route. The
 * bundler already knows which chunks contain each route and which client
 * references those chunks import.
 */
export function collectRouteClientReferences(
	routes: Record<string, RoutePaths> | undefined,
	bundle: Record<string, unknown> | undefined,
	metaMap: Record<string, ClientReferenceMeta> | undefined,
	generatedDir: string,
) {
	// this graph is only available after a completed RSC build
	if (!routes || !bundle || !metaMap) return

	const plan: Record<string, string[]> = {}
	// only output chunks carry module ids and static import edges
	const chunks = Object.values(bundle).filter((chunk): chunk is BuildChunk => {
		if (!chunk || typeof chunk !== 'object') return false

		return (
			'type' in chunk &&
			chunk.type === 'chunk' &&
			'moduleIds' in chunk &&
			Array.isArray(chunk.moduleIds) &&
			'imports' in chunk &&
			Array.isArray(chunk.imports)
		)
	})

	// chunk imports reference file names, so index chunks for lookup
	const chunksByFile = new Map(chunks.map(chunk => [chunk.fileName, chunk]))

	// keep traversal state per route so shared chunks count for every route that uses them
	for (const [route, paths] of Object.entries(routes)) {
		// client reference keys discovered for this route
		const refs = new Set<string>()
		// chunks still waiting to be walked
		const pending = new Set<BuildChunk>()
		// chunk file names already walked for this route, avoiding repeats and cycles
		const seen = new Set<string>()

		for (const file of Object.entries(paths)
			.filter(([key]) => key !== 'middlewares')
			.flatMap(([, value]) => value ?? [])) {
			if (typeof file !== 'string') continue

			const source = normalisePath(path.resolve(generatedDir, file))

			// start from chunks containing this route's page, layout or boundary modules
			for (const chunk of chunks) {
				if (chunk.moduleIds.some(id => id === source || id.startsWith(`${source}.`))) {
					pending.add(chunk)
				}
			}
		}

		// walk static chunk imports from the chunks containing this route
		while (pending.size > 0) {
			const next = pending.values().next()

			if (next.done) break

			const chunk = next.value
			pending.delete(chunk)

			// a chunk can be reached through several imports; visit it once
			if (seen.has(chunk.fileName)) continue
			seen.add(chunk.fileName)

			// client reference module ids identify CSS owned by this chunk
			for (const id of chunk.moduleIds) {
				const meta = metaMap[id]

				if (meta) refs.add(meta.referenceKey)
			}

			// follow imports for shared layouts and nested client boundaries
			for (const imported of chunk.imports) {
				const next = chunksByFile.get(imported)

				if (next) pending.add(next)
			}
		}

		// route patterns are the keys the runtime matches against
		plan[route] = [...refs]
	}

	return plan
}

/**
 * Map each route's client reference keys to the stylesheets in the Vite RSC
 * asset manifest.
 */
export function loadClientCssByRoute(
	routeReferences: Record<string, string[]> | undefined,
	manifest: ClientCssManifest,
) {
	// no route plan means no client CSS to attach
	if (!routeReferences) return

	const plan: Record<string, string[]> = {}

	for (const [route, references] of Object.entries(routeReferences)) {
		// entry CSS always applies; reference CSS is route-specific
		const css = new Set<string>(manifest.entry)

		for (const reference of references) {
			for (const href of manifest.byReference[reference] ?? []) css.add(href)
		}

		plan[route] = [...css]
	}

	return plan
}

async function resolveRouteFile(filePath: string) {
	// manifest paths omit extensions, so probe the supported route extensions
	for (const ext of Config.PAGE_EXTENSIONS) {
		const file = `${filePath}.${ext}`

		if (
			await fs.access(file).then(
				() => true,
				() => false,
			)
		)
			return file
	}

	return null
}

function addCss(css: Set<string>, module: { id: string | null; url: string }) {
	// ignore JS modules and non-CSS assets
	if (!module.id?.endsWith('.css')) return

	const url = module.url.split('?')[0]

	// dev serves CSS as JS by default; ?direct makes it a linkable stylesheet
	if (url) css.add(`${url}?direct`)
}

/**
 * Build a development-only route CSS plan from Vite's module graph. Vite
 * injects CSS through JS in dev, so its URLs are not in the RSC asset manifest.
 */
export async function collectDevClientCss(
	server: ViteDevServer,
	routes: Record<string, RoutePaths> | undefined,
	generatedDir: string,
) {
	const plan: Record<string, string[]> = {}

	const clientCss = new Map<string, Set<string>>()
	const loadedModules = new Set<string>()
	const moduleImports = new Map<string, string[] | null>()

	const routeFiles = new Map<string, string | null>()
	// plugin-rsc records every 'use client' module here during transform
	const metaMap = getPluginApi(server.config)?.manager.clientReferenceMetaMap ?? {}
	// dev environments expose a runner at runtime, but Vite's public type omits it
	const rsc = server.environments.rsc as typeof server.environments.rsc & {
		runner: { import: (url: string) => Promise<unknown> }
	}

	// no routes means there is nothing to map
	if (!routes) return plan

	// resolve each extensionless path once, layouts are shared by several routes
	async function getRouteFile(filePath: string) {
		if (routeFiles.has(filePath)) return routeFiles.get(filePath)

		const resolved = await resolveRouteFile(filePath)

		routeFiles.set(filePath, resolved)
		return resolved
	}

	// import each RSC module once, then cache its direct imports
	async function getModuleImports(file: string) {
		if (moduleImports.has(file)) return moduleImports.get(file) ?? []

		if (!loadedModules.has(file)) {
			loadedModules.add(file)

			try {
				// importing transforms this module and its dependencies into the RSC graph
				await rsc.runner.import(pathToFileURL(file).href)
			} catch {
				// cache failed imports as null so other routes skip them
				moduleImports.set(file, null)
				return []
			}
		}

		// read the graph node that the import created
		const module = server.environments.rsc.moduleGraph.getModuleById(file)
		// missing modules and failed imports both produce no imports
		const imports = module
			? [...module.importedModules].flatMap(imported =>
					imported.id ? [imported.id] : [],
				)
			: null

		moduleImports.set(file, imports)
		return imports ?? []
	}

	// find client boundaries reachable from this route's modules
	async function collectClientModules(files: string[]) {
		const clientModules = new Set<string>()
		const visited = new Set<string>()
		const pending = [...files]

		while (pending.length > 0) {
			const file = pending.pop()

			if (!file || visited.has(file)) continue

			visited.add(file)

			for (const imported of await getModuleImports(file)) {
				// a meta-map entry marks a module as a client boundary
				if (metaMap[imported]) clientModules.add(imported)
				pending.push(imported)
			}
		}

		return clientModules
	}

	// use the SSR graph because it contains CSS imported by client modules
	async function collectCss(clientModule: string) {
		const cached = clientCss.get(clientModule)
		if (cached) return cached

		const css = new Set<string>()

		try {
			// transformRequest loads the module graph without rendering the component
			await server.environments.ssr.transformRequest(pathToFileURL(clientModule).href)
		} catch {
			clientCss.set(clientModule, css)
			return css
		}

		const rootModule = server.environments.ssr.moduleGraph.getModuleById(clientModule)
		const visited = new Set<string>()
		const pending = rootModule ? [...rootModule.importedModules] : []

		// collect CSS modules recursively from the SSR graph
		while (pending.length > 0) {
			const module = pending.pop()

			if (!module?.id || visited.has(module.id)) continue

			visited.add(module.id)
			addCss(css, module)
			pending.push(...module.importedModules)
		}

		clientCss.set(clientModule, css)
		return css
	}

	// produce the same route to CSS map shape as the production build
	for (const [route, paths] of Object.entries(routes)) {
		const files: string[] = []

		for (const file of Object.entries(paths)
			.filter(([key]) => key !== 'middlewares')
			.flatMap(([, value]) => value ?? [])) {
			if (typeof file !== 'string') continue

			const resolved = await getRouteFile(path.resolve(generatedDir, file))

			if (resolved) files.push(resolved)
		}

		const clientModules = await collectClientModules(files)
		const css = new Set<string>()

		for (const clientModule of clientModules) {
			for (const href of await collectCss(clientModule)) css.add(href)
		}

		plan[route] = [...css]
	}

	return plan
}
