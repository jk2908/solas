type BunRequest = Request & { params?: Record<string, string | string[]> }

import { ExportReader } from './utils/export-reader.js'

import type { Build } from './internal/build.js'
import type { HttpRouter } from './internal/http-router/router.js'
import type { Metadata } from './internal/metadata.js'
import type { HttpException } from './internal/navigation/http-exception.js'
import { BrowserRouter } from './internal/browser-router/router.js'
import { Solas } from './solas.js'

export type LogLevel = (typeof Solas.Config.LOG_LEVELS)[number]

type PluginConfigBase = {
	port?: number
	precompress?: boolean
	prerender?: Route.Prerender
	metadata?: Metadata.Item
	trailingSlash?: (typeof Solas.Config.TRAILING_SLASH_MODES)[number]
	readonly logger?: {
		level?: LogLevel
	}
}

export type PluginConfig = PluginConfigBase &
	(
		| {
				url: `http://${string}` | `https://${string}`
				sitemap:
					| true
					| {
							routes: (existing: string[]) => string[] | Promise<string[]>
					  }
		  }
		| {
				url?: `http://${string}` | `https://${string}`
				sitemap?: false
		  }
	)

export type RuntimeConfig = PluginConfig & {
	precompress: NonNullable<PluginConfig['precompress']>
	trailingSlash: NonNullable<PluginConfig['trailingSlash']>
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
	[Solas.Config.REQUEST_META_KEY]: RequestMeta
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
	prerender: Route.Prerender
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
	endpoint?: (req?: BunRequest) => unknown
}

export type ImportMap = Record<string, MapEntry>

export type HttpMethod = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'OPTIONS'

export type Primitive = string | number | boolean | bigint | symbol | null | undefined

export type LooseNumber<T extends number> = T | (number & {})

export type BuildManifest = {
	prerenderRoutes: string[]
	sitemapRoutes: string[]
	precompress: boolean
	trailingSlash: (typeof Solas.Config.TRAILING_SLASH_MODES)[number]
	url?: PluginConfig['url']
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

	export type Prerender = (typeof Solas.Config.PRERENDER_MODES)[number]
}

export type BoundaryError = Error & { digest?: string }
