import type { RscSegment } from '../route-segments.js'

export type RouterNode = {
	id: string
	kind: 'shell' | 'layout' | 'page'
	children?: RouterNode
}

/**
 * Turn a linear layout/page descriptor into a router tree.
 *
 * The router currently fits the tree — it just was not sending one. Keeping
 * this tree shape makes the patch protocol line up with how layouts compose.
 */
export function buildRouterTree(segments: RscSegment | undefined) {
	if (!segments) return undefined

	let node: RouterNode | undefined = segments.page
		? { id: segments.page, kind: 'page' }
		: undefined

	for (let index = segments.layouts.length - 1; index >= 0; index--) {
		const id = segments.layouts[index]
		if (!id) continue

		node = {
			id,
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
