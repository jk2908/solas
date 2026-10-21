import type { PluginOption } from 'vite'

import { ExportReader } from './utils/export-reader.js'

import type * as BrowserRouter from './internal/browser-router/shared.js'
import type { HttpRouter } from './internal/http-router/router.js'
import type { Metadata } from './internal/metadata.js'
import type { HttpException } from './internal/navigation/http-exception.js'
import * as Config from './config.js'
import * as Build from './internal/build.js'

export type LogLevel = (typeof Config.LOG_LEVELS)[number]

export type Origin = `http://${string}` | `https://${string}`

/**
 * Response headers to add to every response Solas serves. A function form
 * receives the request, for headers that depend on it (for example a
 * per-request CSP nonce).
 */
export type HeaderEntries = Record<string, string>
export type HeadersInput =
	| HeaderEntries
	| ((req: Request) => HeaderEntries | Promise<HeaderEntries>)

/**
 * CSP directives. Keywords such as `self` and `none` may be written without
 * their surrounding quotes.
 */
export type CspDirectives = Record<string, readonly string[]>

/**
 * Structured CSP configuration. Solas uses nonces for dynamic responses,
 * hashes for prerendered responses, and both for PPR.
 */
export type CspConfig = {
	directives: CspDirectives
}

/**
 * A platform deployment adapter. Solas registers `plugins` alongside its own,
 * so adapters are configured here instead of being spread into the Vite plugins
 * array.
 */
export type Adapter = {
	name: string
	plugins: PluginOption[]
	/**
	 * Prerender mode the platform requires, which overrides the `solas()`
	 * option. A static host has no server, so it needs `'full'`.
	 */
	prerender?: Route.PrerenderMode | false
}

type PluginConfigBase = {
	precompress?: boolean
	prerender?: Route.PrerenderMode | false
	metadata?: Metadata.Item
	trailingSlash?: (typeof Config.TRAILING_SLASH_MODES)[number]
	trustedOrigins?: readonly string[]
	headers?: HeadersInput
	csp?: CspConfig
	adapter?: Adapter
	readonly logger?: {
		level?: LogLevel
	}
}

export type PluginConfig = PluginConfigBase & {
	url?: string
	sitemap?:
		| boolean
		| {
				routes: (existing: string[]) => string[] | Promise<string[]>
		  }
}

export type ConfiguredPluginConfig = PluginConfig

export type RuntimeConfig = PluginConfig & {
	precompress: NonNullable<PluginConfig['precompress']>
	trailingSlash: NonNullable<PluginConfig['trailingSlash']>
	trustedOrigins: NonNullable<PluginConfig['trustedOrigins']>
}

export type BuildContext = {
	prerenderRoutes: Set<string>
	knownRoutes: Set<string>
	exportReader: ExportReader
	command?: 'build' | 'serve'
}

export type RequestMeta = {
	error?: HttpException | Error
	action?: boolean
	match: HttpRouter.Match | null
	parsedFormData?: FormData | null
	url?: URL
}

export type SolasRequest = Request & {
	[Config.REQUEST_META_KEY]: RequestMeta
}

export type Segment = {
	__id: string
	__path: string
	__params: string[]
	__kind: typeof Build.EntryKind.PAGE
	__depth: number
	method: 'get'
	paths: {
		layouts: (string | null)[]
		'401s': (string | null)[]
		'403s': (string | null)[]
		'404s': (string | null)[]
		'500s': (string | null)[]
		loaders: (string | null)[]
		middlewares: (string | null)[]
		page?: string | null
	}
	error?: HttpException | Error
	prerender: Route.PrerenderMode | false
	dynamic: boolean
	wildcard: boolean
}

export type Endpoint = {
	__id: string
	__path: string
	__params: string[]
	__kind: typeof Build.EntryKind.ENDPOINT
	method: Lowercase<HttpMethod>
	middlewares: (string | null)[]
}

export type ManifestEntry = Segment | Endpoint
export type ManifestEntryGroup = ManifestEntry | [ManifestEntry, ...ManifestEntry[]]

export type Manifest = Awaited<
	ReturnType<typeof Build.Finder.prototype.process>
>['manifest']

export type View<TProps> =
	| React.ComponentType<TProps>
	| React.LazyExoticComponent<React.ComponentType<TProps>>

export type StaticImport = Record<string, unknown>
export type DynamicImport<T = Record<string, unknown>> = () => Promise<T>

export type MapEntry = {
	shell?: StaticImport
	page?: DynamicImport
	layouts?: readonly (DynamicImport | null)[]
	'401s'?: readonly (DynamicImport | null)[]
	'403s'?: readonly (DynamicImport | null)[]
	'404s'?: readonly (DynamicImport | null)[]
	'500s'?: readonly (DynamicImport | null)[]
	loaders?: readonly (DynamicImport | null)[]
	middlewares?: readonly (HttpRouter.Middleware | null)[]
	endpoint?: (req?: Request) => unknown
}

export type ImportMap = Record<string, MapEntry>

export type HttpMethod = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'OPTIONS'

export type Primitive = string | number | boolean | bigint | symbol | null | undefined

export type LooseNumber<T extends number> = T | (number & {})

export type BuildManifest = {
	base: string
	publicFiles: string[]
	prerenderRoutes: string[]
	sitemapRoutes: string[]
	precompress: boolean
	trailingSlash: (typeof Config.TRAILING_SLASH_MODES)[number]
	url?: string
	adapter?: string
}

export namespace Route {
	type ParamsOf<TRoute> = TRoute extends {
		params?: infer TParams extends BrowserRouter.Params
	}
		? TParams
		: never

	type ErrorPropsOf<TError> = [TError] extends [never] ? {} : { error?: TError }

	export type Params<TRoute> = ParamsOf<TRoute>

	export type Metadata<TRoute = { params?: BrowserRouter.Params }, TError = never> =
		| Metadata.Item
		| ((
				input: Metadata.Input<ParamsOf<TRoute>, TError>,
		  ) => Promise<Metadata.Item> | Metadata.Item)

	export type StaticParams<TRoute> = [ParamsOf<TRoute>] extends [never]
		? never
		: () => readonly ParamsOf<TRoute>[] | Promise<readonly ParamsOf<TRoute>[]>

	export type Props<TRoute, TError = never> = ([ParamsOf<TRoute>] extends [never]
		? { params?: never }
		: { params: ParamsOf<TRoute> }) &
		ErrorPropsOf<TError>

	export type PrerenderMode = (typeof Config.PRERENDER_MODES)[number]
}
