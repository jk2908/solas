import { describe, expect, it, vi } from 'vitest'

import { createRevalidationChannel } from '../../../../src/internal/browser-router/revalidation.js'

describe('createRevalidationChannel', () => {
	it('broadcasts invalidations to other tabs', async () => {
		const other = vi.fn()
		const first = createRevalidationChannel(() => {})
		const second = createRevalidationChannel(other)
		const paths = [{ path: '/posts', scope: 'page' as const }]

		first.broadcast(paths)

		await vi.waitFor(() => {
			expect(other).toHaveBeenCalledWith(paths)
		})

		first.close()
		second.close()
	})
})
