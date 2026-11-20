import { beforeEach, describe, expect, it } from 'vitest'

import {
	drainRevalidatedPaths,
	drainRevalidatedTags,
	revalidatePath,
	revalidateTag,
} from '../../../../src/internal/server/revalidate.js'

describe('revalidateTag', () => {
	beforeEach(() => {
		drainRevalidatedTags()
	})

	it('collects tags until they are drained', () => {
		revalidateTag('segment:one')
		revalidateTag('segment:two')
		revalidateTag('segment:one')

		expect(drainRevalidatedTags()).toEqual(['segment:one', 'segment:two'])
		expect(drainRevalidatedTags()).toEqual([])
	})

	it('ignores empty tags', () => {
		revalidateTag('')
		expect(drainRevalidatedTags()).toEqual([])
	})
})

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
