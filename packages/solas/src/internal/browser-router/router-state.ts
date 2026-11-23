import type { RscSegment } from '../route-segments.js'

export type RouterNode = {
	id: string
	kind: 'shell' | 'layout' | 'page'
	children?: RouterNode
}

/**
 * Turn the linear layout/page descriptor into a nested router tree.
 *
 * The tree mirrors how layouts compose, so the server can diff a target chain
 * against the chain already rendered by the client.
 */
export function buildRouterTree(segments: RscSegment | undefined) {
	if (!segments) return undefined

	const layoutIds = segments.layouts.filter((id): id is string => id !== null)
	let node: RouterNode | undefined = segments.page
		? { id: segments.page, kind: 'page' }
		: undefined

	for (let index = layoutIds.length - 1; index >= 0; index--) {
		node = {
			id: layoutIds[index],
			kind: index === 0 ? 'shell' : 'layout',
			children: node,
		}
	}

	return node
}

/**
 * Return the layout IDs from a router tree in render order.
 */
export function layoutIdsFromTree(tree: RouterNode | undefined) {
	const ids: string[] = []

	function visit(node: RouterNode | undefined) {
		if (!node) return
		if (node.kind !== 'page') ids.push(node.id)
		visit(node.children)
	}

	visit(tree)

	return ids
}
