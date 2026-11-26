import { isCSSRequest } from 'vite'

import { describe, expect, it } from 'vitest'

import { createScanCssStubPlugin } from '../../../src/internal/scan-css.js'

const plugin = createScanCssStubPlugin()
const resolve = (id: string) =>
	(plugin.resolveId as unknown as (id: string) => string | undefined)(id)
const load = (id: string) =>
	(plugin.load as unknown as (id: string) => string | undefined)(id)

describe('scan CSS stub', () => {
	it('stubs plain and module CSS', () => {
		for (const id of ['/app/styles.css', '/app/theme.module.css']) {
			const virtual = resolve(id)

			expect(virtual?.startsWith('\u0000solas-scan-css:')).toBe(true)
			expect(isCSSRequest(virtual!)).toBe(false)
			expect(load(virtual!)).toBe('export default {}')
		}
	})

	it('stubs inline CSS as an empty string', () => {
		const virtual = resolve('/app/theme.css?inline')

		expect(virtual?.startsWith('\u0000solas-scan-css-inline:')).toBe(true)
		expect(load(virtual!)).toBe('export default ""')
	})

	it('leaves raw and url imports to Vite', () => {
		expect(resolve('/app/theme.css?raw')).toBeUndefined()
		expect(resolve('/app/theme.css?url')).toBeUndefined()
	})

	it('ignores non-CSS imports', () => {
		expect(resolve('/app/page.tsx')).toBeUndefined()
	})
})
