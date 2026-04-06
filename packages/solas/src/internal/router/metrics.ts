export type NavigationTiming = {
	id: number
	startedAt: number
	path: string
	resolvedPath: string
	prefetched: boolean
	warmHit: boolean
	fetchMs: number
	parseMs: number
	readyMs: number
	commitMs?: number
}

export type WarmTiming = {
	id: number
	startedAt: number
	path: string
	cacheHit: boolean
	fetchMs: number
	parseMs: number
	readyMs: number
	commitMs?: number
}

export function now() {
	return typeof performance === 'undefined' ? Date.now() : performance.now()
}