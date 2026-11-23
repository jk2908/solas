import { describe, expect, it } from 'vitest'

import {
	drainRevalidatedPaths,
	revalidatePath,
	runWithRevalidations,
} from '../../../../src/internal/server/revalidate.js'

describe('revalidatePath', () => {
	it('collects page and layout invalidations', () => {
		runWithRevalidations(paths => {
			revalidatePath('/about/another')
			revalidatePath('/about?x=1', 'layout')

			expect(drainRevalidatedPaths()).toEqual([
				{ path: '/about/another', scope: 'page' },
				{ path: '/about', scope: 'layout' },
			])
			expect(paths).toEqual([])
		})
	})

	it('keeps concurrent request invalidations separate', async () => {
		const first = runWithRevalidations(async paths => {
			revalidatePath('/first')
			await new Promise(resolve => setTimeout(resolve, 5))
			return paths.splice(0)
		})

		const second = runWithRevalidations(paths => {
			revalidatePath('/second', 'layout')
			return paths.splice(0)
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
