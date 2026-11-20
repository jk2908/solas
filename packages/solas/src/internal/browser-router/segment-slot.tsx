'use client'

import { createContext, Suspense, useContext, type ReactNode } from 'react'

import type { RscPayload } from '../env/rsc.js'
import { Head } from '../render/head.js'

export type SegmentState = {
	page: RscPayload | null
}

export const SegmentContext = createContext<SegmentState | null>(null)

/**
 * Render the page segment fetched after a shell navigation.
 */
export function SegmentSlot({ fallback }: { fallback?: ReactNode }) {
	const segment = useContext(SegmentContext)
	const page = segment?.page

	if (!page) return fallback ?? null

	return (
		<Suspense fallback={fallback ?? null}>
			<Head metadata={page.metadata} url={page.url} clientCss={page.clientCss} />
			{page.root}
		</Suspense>
	)
}
