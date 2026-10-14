import { describe, it, expect } from 'vitest'

import staticAdapter from '../../../src/adapters/static.js'

describe('static adapter', () => {
	it('forces full prerendering', () => {
		const adapter = staticAdapter()

		expect(adapter.name).toBe('static')
		expect(adapter.prerender).toBe('full')
	})

	it('exposes a post-build plugin that assembles the site', () => {
		const adapter = staticAdapter()

		const plugin = adapter.plugins[0] as {
			name: string
			buildApp: { order: string; handler: unknown }
		}

		expect(plugin.name).toBe('solas-static')
		expect(plugin.buildApp.order).toBe('post')
		expect(typeof plugin.buildApp.handler).toBe('function')
	})
})
