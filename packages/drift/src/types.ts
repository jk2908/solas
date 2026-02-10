type BunRequest = Request & { params?: Record<string, string | string[]> }

import { Config } from './config'

import type { Build } from './internal/build'

import type { Metadata } from './internal/metadata'
import type { HttpException } from './internal/navigation/http-exception'
import type { Router } from './internal/router/router'
import type { LogLevel } from './utils/logger'

export type PrerenderMode = 'declarative' | 'full' | false
export type SegmentPrerender = 'ppr' | 'full' | false

export type PluginConfig = {
	url?: `http://${string}` | `https://${string}`
	precompress?: boolean
	prerender?: PrerenderMode
	outDir?: string
	metadata?: Metadata.Item
	trailingSlash?: boolean
	readonly logger?: {
		level?: LogLevel
	}
}

export type BuildContext = {
	outDir: string
	bundle: {
		server: {
			entryPath: string | null
			outDir: string | null
		}
		client: {
			entryPath: string | null
			outDir: string | null
		}
	}
	transpiler: InstanceType<typeof Bun.Transpiler>
	prerenderedRoutes: Set<string>
}

export type DriftRequest = Request & {
	[Config.$]: {
		error?: HttpException | Error
		match: Router.Match | null
	}
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
		'404s': (string | null)[]
		loaders: (string | null)[]
		middlewares: (string | null)[]
		page?: string | null
	}
	error?: HttpException | Error
	prerender: SegmentPrerender
	dynamic: boolean
	catch_all: boolean
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
	'404s'?: readonly (DynamicImport | null)[]
	loaders?: readonly (DynamicImport | null)[]
	middlewares?: readonly (Router.Middleware | null)[]
	endpoint?: (req?: BunRequest) => unknown
}

export type ImportMap = Record<string, MapEntry>

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'

export type Primitive = string | number | boolean | bigint | symbol | null | undefined

export type LooseNumber<T extends number> = T | (number & {})

export type BuildManifest = {
	prerenderableRoutes: string[]
	outDir: string
	precompress: boolean
}
