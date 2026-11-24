import { describe, expect, it } from 'vitest'

import {
	consumeRevalidatedPaths,
	revalidatePath,
	withRevalidations,
} from '../../../../src/internal/server/revalidate.js'

describe('revalidatePath', () => {
	it('collects page and layout invalidations', () => {
		withRevalidations(() => {
			revalidatePath('/about/another')
			revalidatePath('/about?x=1', 'layout')

			expect(consumeRevalidatedPaths()).toEqual([
				{ path: '/about/another', scope: 'page' },
				{ path: '/about', scope: 'layout' },
			])
		})
	})

	it('keeps concurrent request invalidations separate', async () => {
		const first = withRevalidations(async () => {
			revalidatePath('/first')
			await new Promise(resolve => setTimeout(resolve, 5))
			return consumeRevalidatedPaths()
		})

		const second = withRevalidations(() => {
			revalidatePath('/second', 'layout')
			return consumeRevalidatedPaths()
		})

		expect(await first).toEqual([{ path: '/first', scope: 'page' }])
		expect(second).toEqual([{ path: '/second', scope: 'layout' }])
	})

	it('rejects calls outside a request', () => {
		expect(() => revalidatePath('/about')).toThrow(
			'revalidatePath must be called during a request',
		)
	})
})
