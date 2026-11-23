import { describe, expect, it } from 'vitest'

import {
	buildRouterTree,
	layoutIdsFromTree,
} from '../../../../src/internal/browser-router/router-state.js'

describe('router state', () => {
	it('builds a nested layout tree', () => {
		const tree = buildRouterTree({
			layouts: ['shell', 'dashboard'],
			page: 'settings',
		})

		expect(tree).toEqual({
			id: 'shell',
			kind: 'shell',
			children: {
				id: 'dashboard',
				kind: 'layout',
				children: { id: 'settings', kind: 'page' },
			},
		})
	})

	it('extracts layout IDs in render order', () => {
		const tree = buildRouterTree({
			layouts: ['shell', 'dashboard'],
			page: 'settings',
		})

		expect(layoutIdsFromTree(tree)).toEqual(['shell', 'dashboard'])
	})
})
