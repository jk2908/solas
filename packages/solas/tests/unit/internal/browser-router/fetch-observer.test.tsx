import { afterEach, describe, expect, it, vi } from 'vitest'

import * as Config from '../../../../src/config.js'
import * as Events from '../../../../src/events.js'
import { observeFetch } from '../../../../src/internal/browser-router/fetch-observer.js'

const originalFetch = window.fetch

describe('observeFetch', () => {
	afterEach(() => {
		window.fetch = originalFetch
		Reflect.deleteProperty(window, Symbol.for(`${Config.SLUG}.fetch`))
		vi.restoreAllMocks()
	})

	it('dispatches invalidations from fetch responses', async () => {
		const paths = [{ path: '/posts', scope: 'page' }]
		const nativeFetch = vi.fn(
			async () =>
				new Response('ok', {
					headers: {
						[Config.INVALIDATED_PATHS_HEADER]: JSON.stringify(paths),
					},
				}),
		) as unknown as typeof window.fetch

		window.fetch = nativeFetch
		observeFetch()

		const listener = vi.fn()
		window.addEventListener(Events.REVALIDATE, listener)

		await window.fetch('/api/posts')

		expect(listener).toHaveBeenCalledOnce()
		expect(listener.mock.calls[0]?.[0].detail).toEqual({ paths })

		window.removeEventListener(Events.REVALIDATE, listener)
	})
})
