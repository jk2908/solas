type BunRequest = Request & { params?: Record<string, string | string[]> }

import type { HttpException } from './shared/http-exception'
import type { Logger, LogLevel } from './shared/logger'
import type { Metadata } from './shared/metadata'

import type { Router } from './server/router'

import type { Build } from './build'

export type PluginConfig = {
	app?: {
		url?: `http://${string}` | `https://${string}`
	}
	precompress?: boolean
	prerender?: 'full' | 'declarative'
	outDir?: string
	metadata?: Metadata.Collection
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
	logger: InstanceType<typeof Logger>
	prerenderableRoutes: Set<string>
}

export type DriftRequest = Request & {
	error?: HttpException | Error
	match: Router.Match | null
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
	prerender: boolean
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
	ReturnType<typeof Build.RouteProcessor.prototype.process>
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
