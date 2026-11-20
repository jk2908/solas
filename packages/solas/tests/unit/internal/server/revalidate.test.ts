import { beforeEach, describe, expect, it } from 'vitest'

import {
	drainRevalidatedTags,
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
