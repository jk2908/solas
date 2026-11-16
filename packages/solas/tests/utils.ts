import type { RequestCache } from '../src/internal/env/request-context.js'
import type { HttpRouter } from '../src/internal/http-router/router.js'
import type {
	Endpoint,
	Manifest,
	RequestMeta,
	Segment,
	SolasRequest,
} from '../src/types.js'
import { HttpException } from '../src/internal/navigation/http-exception.js'

export const EMPTY_PATHS = {
	layouts: [],
	'401s': [],
	'403s': [],
	'404s': [],
	'500s': [],
	loaders: [],
	middlewares: [],
	page: null,
}

export function createSegment(path: string, overrides: Partial<Segment> = {}): Segment {
	return {
		__kind: '$P' as const,
		__id: `p_${path}`,
		__path: path,
		__params: [],
		__depth: path === '/' ? 0 : path.split('/').length - 1,
		method: 'get' as const,
		paths: { ...EMPTY_PATHS },
		prerender: false,
		dynamic: false,
		wildcard: false,
		...overrides,
	}
}

export function createEndpoint(
	path: string,
	overrides: Partial<Endpoint> = {},
): Endpoint {
	return {
		__kind: '$E' as const,
		__id: `e_${path}`,
		__path: path,
		__params: [],
		method: 'get' as const,
		middlewares: [],
		...overrides,
	}
}

export function createSegmentWith404(path: string): Segment {
	return createSegment(path, {
		paths: { ...EMPTY_PATHS, '404s': ['./+404.tsx'] },
	})
}

export function createRouterMatch(
	overrides: { params?: HttpRouter.Params } = {},
): HttpRouter.Match {
	return Object.assign(
		{
			route: {
				path: '/about',
				method: 'GET' as const,
				handler: undefined,
				middleware: [] as never[],
				tokens: [{ kind: 'static' as const, value: '/about' }],
				length: 1,
				score: 0,
				wildcard: false,
			},
			params: {},
		},
		overrides,
	)
}

export function createMatch(
	overrides: { error?: HttpException | Error; params?: Record<string, string> } = {},
) {
	return 'error' in overrides
		? { ...createSegment('/'), params: overrides.params ?? {}, error: overrides.error }
		: { ...createSegment('/'), params: overrides.params ?? {} }
}

export function mockRequestContext(
	req: Request,
	cache: RequestCache = {},
	prerender: {
		prerender: null | 'full' | 'ppr'
		request: SolasRequest
		cache: RequestCache
	}['prerender'] = null,
) {
	const meta: { [key: string]: RequestMeta } = { __SOLAS__: { match: null } }
	const solasReq: SolasRequest = Object.assign(req, meta)
	return { request: solasReq, prerender, cache }
}

export async function drainStream(stream: ReadableStream<Uint8Array>): Promise<string> {
	const reader = stream.getReader()
	const chunks: Uint8Array[] = []
	while (true) {
		const { done, value } = await reader.read()
		if (done) break
		if (value) chunks.push(value)
	}
	return chunks.map(c => new TextDecoder().decode(c)).join('')
}

export function createManifest(...entries: [string, Segment | Segment[]][]): Manifest {
	return Object.fromEntries(entries)
}
