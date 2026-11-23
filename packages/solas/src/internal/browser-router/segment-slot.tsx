'use client'

import {
	createContext,
	isValidElement,
	Suspense,
	useContext,
	type ReactElement,
	type ReactNode,
} from 'react'

import type { RscPayload } from '../env/rsc.js'
import type { Metadata } from '../metadata.js'
import { HttpExceptionBoundary } from '../navigation/http-exception-boundary.js'

export type SegmentMeta = {
	loading?: ReactNode
	errors?: Partial<Record<401 | 403 | 404 | 500, ReactElement | null>>
	head?: Metadata.Item | Promise<Metadata.Item>
}

export type SegmentReference = {
	id: string
	meta?: SegmentMeta
}

export type SegmentState = {
	page: RscPayload | null
	layouts: Map<string, ReactNode>
	meta: Map<string, SegmentMeta>
}

export const SegmentContext = createContext<SegmentState | null>(null)

/**
 * Supplies the target subtree for an independently cached layout node.
 */
const ChildContext = createContext<ReactNode>(null)

export function ChildSlot() {
	return useContext(ChildContext)
}

/**
 * Marks the page root inside a combined page/layout segment patch.
 */
export function PageMarker(props: { segment: SegmentReference; children?: ReactNode }) {
	return props.children
}

/**
 * Marks a segment that called `dynamic()` during the current request.
 */
export function DynamicSegmentMarker(props: { id: string; dynamic?: true }) {
	void props
	return null
}

/**
 * A node in the server patch tree. It is only collected client-side.
 */
export function PatchNode(props: {
	id: string
	kind: 'shell' | 'layout' | 'page'
	node?: ReactNode
	children?: ReactNode
}) {
	void props
	return null
}

/**
 * Render the page segment fetched after a shell navigation.
 */
export function SegmentSlot({
	id,
	fallback,
	children,
}: {
	id?: string
	fallback?: ReactNode
	children?: ReactNode
}) {
	const context = useContext(SegmentContext)
	const page = context?.page
	const meta = id ? context?.meta.get(id) : undefined

	if (!page) return children ?? meta?.loading ?? fallback ?? null

	return (
		<Suspense fallback={meta?.loading ?? fallback ?? children ?? null}>
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
	segment?: SegmentReference
	child?: ReactNode
	children?: ReactNode
}) {
	const context = useContext(SegmentContext)
	const patched = context?.layouts.get(props.id)

	if (patched) {
		// Request-time layout nodes have a child slot. The target subtree is
		// passed separately so the cached node does not own its descendants.
		const meta = context?.meta.get(props.id)
		let content = (
			<ChildContext.Provider value={props.child ?? null}>{patched}</ChildContext.Provider>
		)

		if (meta?.loading) {
			content = <Suspense fallback={meta.loading}>{content}</Suspense>
		}

		if (meta?.errors) {
			content = (
				<HttpExceptionBoundary components={meta.errors}>{content}</HttpExceptionBoundary>
			)
		}

		return content
	}

	return props.children ?? null
}

/**
 * Walk a decoded RSC tree, including arrays and nested segment children.
 */
function walkSegments(
	root: ReactNode,
	visit: (
		value: React.ReactElement<{
			segment?: SegmentReference
			children?: ReactNode
			node?: ReactNode
			id?: string
			dynamic?: true
		}>,
	) => false | void,
) {
	if (Array.isArray(root)) {
		for (const child of root) walkSegments(child, visit)
		return
	}

	if (!isValidElement(root)) return

	const value = root as React.ReactElement<{
		segment?: SegmentReference
		children?: ReactNode
		node?: ReactNode
		id?: string
		dynamic?: true
	}>

	if (visit(value) === false) return

	walkSegments(value.props.node ?? null, visit)
	walkSegments(value.props.children ?? null, visit)
}

/**
 * Collect the page, layout nodes and segment metadata from one patch payload.
 */
export function collectSegments(
	root: ReactNode,
	layoutIds: string[],
	pageId?: string | null,
) {
	const layouts = new Map<string, ReactNode>()
	const meta = new Map<string, SegmentMeta>()
	const dynamic = new Set<string>()
	const targets = new Set(layoutIds)
	let page: ReactNode = null

	walkSegments(root, value => {
		const props = value.props
		if (props.dynamic === true && typeof props.id === 'string') dynamic.add(props.id)

		const segment = props.segment
		if (!segment) return

		if (segment.meta) meta.set(segment.id, segment.meta)

		if (segment.id === pageId) {
			page = props.children ?? null
			return false
		}

		if (targets.has(segment.id)) {
			layouts.set(segment.id, props.children)
		}
	})

	return { page, layouts, meta, dynamic }
}
