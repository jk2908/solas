import { describe, expect, it } from 'vitest'

import {
	enableRevalidations,
	getRevalidatedPaths,
	revalidatePath,
	withRevalidations,
} from '../../../../src/internal/server/revalidate.js'

describe('revalidatePath', () => {
	it('collects page and layout invalidations', () => {
		withRevalidations(() => {
			enableRevalidations()
			revalidatePath('/about/another')
			revalidatePath('/about?x=1', 'layout')

			expect(getRevalidatedPaths()).toEqual([
				{ path: '/about/another', scope: 'page' },
				{ path: '/about', scope: 'layout' },
			])
		})
	})

	it('keeps concurrent request invalidations separate', async () => {
		const first = withRevalidations(async () => {
			enableRevalidations()
			revalidatePath('/first')
			await new Promise(resolve => setTimeout(resolve, 5))
			return getRevalidatedPaths()
		})

		const second = withRevalidations(() => {
			enableRevalidations()
			revalidatePath('/second', 'layout')
			return getRevalidatedPaths()
		})

		expect(await first).toEqual([{ path: '/first', scope: 'page' }])
		expect(second).toEqual([{ path: '/second', scope: 'layout' }])
	})

	it('rejects calls outside a request', () => {
		expect(() => revalidatePath('/about')).toThrow()
	})

	it('rejects calls outside a Server Action', () => {
		withRevalidations(() => {
			expect(() => revalidatePath('/about')).toThrow(
				'revalidatePath can only be called from a Server Action',
			)
		})
	})
})
