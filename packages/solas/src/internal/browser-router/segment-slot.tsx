'use client'

import {
	createContext,
	isValidElement,
	Suspense,
	useContext,
	type ReactNode,
} from 'react'

import type { RscPayload } from '../env/rsc.js'
import { Head } from '../render/head.js'

export type SegmentState = {
	page: RscPayload | null
	layouts: Map<string, ReactNode>
}

export const SegmentContext = createContext<SegmentState | null>(null)

/**
 * Render the page segment fetched after a shell navigation.
 */
export function SegmentSlot({
	fallback,
	children,
}: {
	fallback?: ReactNode
	children?: ReactNode
}) {
	const segment = useContext(SegmentContext)
	const page = segment?.page

	if (!page) return children ?? fallback ?? null

	return (
		<Suspense fallback={fallback ?? children ?? null}>
			<Head metadata={page.metadata} url={page.url} clientCss={page.clientCss} />
			{page.root}
		</Suspense>
	)
}

/**
 * A layout slot. The shell renders its static layout until a request-time
 * layout node is available in the segment store.
 */
export function LayoutSlot(props: {
	id: string
	pprLayout?: true
	fallback?: ReactNode
	children?: ReactNode
}) {
	const segment = useContext(SegmentContext)
	const patched = segment?.layouts.get(props.id)

	return patched ?? props.children ?? props.fallback ?? null
}

/**
 * Collect layout nodes from a decoded RSC tree.
 */
export function collectLayoutSegments(root: ReactNode) {
	const layouts = new Map<string, ReactNode>()

	function visit(value: unknown) {
		if (Array.isArray(value)) {
			for (const child of value) visit(child)
			return
		}

		if (!isValidElement(value)) return

		const props = value.props as {
			id?: string
			pprLayout?: true
			children?: ReactNode
		}

		if (props.pprLayout === true && typeof props.id === 'string') {
			layouts.set(props.id, props.children)
		}

		visit(props.children)
	}

	visit(root)

	return layouts
}
