import { describe, it, expect } from 'vitest'

import staticAdapter from '../../../src/adapters/static.js'

type Named = { name: string; buildApp?: { order: string; handler: unknown } }

describe('static adapter', () => {
	it('forces full prerendering', () => {
		const adapter = staticAdapter()

		expect(adapter.name).toBe('static')
		expect(adapter.prerender).toBe('full')
	})

	it('installs the guards and a post-build plugin', () => {
		const plugins = staticAdapter().plugins as Named[]
		const names = plugins.map(plugin => plugin.name)

		expect(names).toContain('solas:guards')
		expect(names).toContain('solas-static')

		const builder = plugins.find(plugin => plugin.name === 'solas-static')

		expect(builder?.buildApp?.order).toBe('post')
		expect(typeof builder?.buildApp?.handler).toBe('function')
	})
})
