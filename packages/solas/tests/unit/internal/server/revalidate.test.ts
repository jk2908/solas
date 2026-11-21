import { beforeEach, describe, expect, it } from 'vitest'

import {
	drainRevalidatedPaths,
	revalidatePath,
} from '../../../../src/internal/server/revalidate.js'

describe('revalidatePath', () => {
	beforeEach(() => {
		drainRevalidatedPaths()
	})

	it('collects page and layout invalidations', () => {
		revalidatePath('/about/another')
		revalidatePath('/about?x=1', 'layout')

		expect(drainRevalidatedPaths()).toEqual([
			{ path: '/about/another', scope: 'page' },
			{ path: '/about', scope: 'layout' },
		])
	})
})
