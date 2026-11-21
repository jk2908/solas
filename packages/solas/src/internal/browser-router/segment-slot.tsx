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
export function PageMarker({ children }: { pprPage?: true; children?: ReactNode }) {
	return children
}

export function SegmentMetaMarker({
	id: _id,
	pprMeta: _pprMeta,
	loading: _loading,
	errors: _errors,
	head: _head,
}: {
	id: string
	pprMeta?: true
	loading?: ReactNode
	errors?: SegmentMeta['errors']
	head?: SegmentMeta['head']
}) {
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
	const segment = useContext(SegmentContext)
	const page = segment?.page
	const meta = id ? segment?.meta.get(id) : undefined

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
	pprLayout?: true
	child?: ReactNode
	children?: ReactNode
}) {
	const segment = useContext(SegmentContext)
	const patched = segment?.layouts.get(props.id)

	if (patched) {
		// Request-time layout nodes have a child slot. The target subtree is
		// passed separately so the cached node does not own its descendants.
		const meta = segment?.meta.get(props.id)
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
 * Find the page root inside a combined page/layout segment patch.
 */
export function collectPageSegment(root: ReactNode) {
	let page: ReactNode = null

	function visit(value: unknown) {
		if (Array.isArray(value)) {
			for (const child of value) visit(child)
			return
		}

		if (!isValidElement(value)) return

		const props = value.props as { pprPage?: true; children?: ReactNode }

		if (props.pprPage === true) {
			page = props.children ?? null
			return
		}

		visit(props.children)
	}

	visit(root)

	return page
}

/**
 * Collect loading/error metadata attached to segment patch markers.
 */
export function collectSegmentMeta(root: ReactNode) {
	const meta = new Map<string, SegmentMeta>()

	function visit(value: unknown) {
		if (Array.isArray(value)) {
			for (const child of value) visit(child)
			return
		}

		if (!isValidElement(value)) return

		const props = value.props as {
			id?: string
			pprMeta?: true
			loading?: ReactNode
			errors?: SegmentMeta['errors']
			head?: SegmentMeta['head']
			children?: ReactNode
		}

		if (props.pprMeta === true && typeof props.id === 'string') {
			meta.set(props.id, {
				loading: props.loading,
				errors: props.errors,
				head: props.head,
			})
		}

		visit(props.children)
	}

	visit(root)

	return meta
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
