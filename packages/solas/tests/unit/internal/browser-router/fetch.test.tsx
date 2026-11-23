import { afterEach, describe, expect, it, vi } from 'vitest'

import * as Config from '../../../../src/config.js'
import * as Events from '../../../../src/events.js'
import { solasFetch } from '../../../../src/internal/browser-router/fetch.js'

describe('solasFetch', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('dispatches invalidations from the response header', async () => {
		const paths = [{ path: '/posts', scope: 'page' }]
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response('ok', {
				headers: {
					[Config.INVALIDATED_PATHS_HEADER]: JSON.stringify(paths),
				},
			}),
		)

		const listener = vi.fn()
		window.addEventListener(Events.REVALIDATE, listener)

		await solasFetch('/api/posts')

		expect(listener).toHaveBeenCalledOnce()
		expect(listener.mock.calls[0]?.[0].detail).toEqual({ paths })

		window.removeEventListener(Events.REVALIDATE, listener)
	})
})
