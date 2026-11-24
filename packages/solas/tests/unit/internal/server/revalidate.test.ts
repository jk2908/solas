import { describe, expect, it, vi } from 'vitest'

import {
	getRevalidatedPaths,
	publishRevalidations,
	revalidatePath,
	subscribeRevalidations,
	withRevalidations,
} from '../../../../src/internal/server/revalidate.js'

describe('revalidatePath', () => {
	it('collects page and layout invalidations', () => {
		withRevalidations(() => {
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
			revalidatePath('/first')
			await new Promise(resolve => setTimeout(resolve, 5))
			return getRevalidatedPaths()
		})

		const second = withRevalidations(() => {
			revalidatePath('/second', 'layout')
			return getRevalidatedPaths()
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

describe('revalidation events', () => {
	it('publishes invalidations to subscribers', () => {
		const listener = vi.fn()
		const unsubscribe = subscribeRevalidations(listener)
		const paths = [{ path: '/posts', scope: 'page' as const }]

		publishRevalidations(paths)
		unsubscribe()
		publishRevalidations(paths)

		expect(listener).toHaveBeenCalledOnce()
		expect(listener).toHaveBeenCalledWith(paths)
	})
})
