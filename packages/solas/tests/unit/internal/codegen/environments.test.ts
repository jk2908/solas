import { describe, it, expect } from 'vitest'

import {
	writeRSCEntry,
	writeSSREntry,
	writeBrowserEntry,
	writeCloudflareEntry,
} from '../../../../src/internal/codegen/environments.js'

describe('writeRSCEntry', () => {
	it('generates RSC handler code', () => {
		const result = writeRSCEntry({ trailingSlash: 'never' })
		expect(result).toContain(
			'export default await createRuntimeHandler(config, manifest, importMap)',
		)
		expect(result).toContain(
			"import { createRuntimeHandler } from '@jk2908/solas/env/rsc'",
		)
	})

	it('includes hmr accept', () => {
		const result = writeRSCEntry({})
		expect(result).toContain('import.meta.hot')
	})

	it('snapshot', () => {
		expect(writeRSCEntry({ trailingSlash: 'never' })).toMatchSnapshot()
	})
})

describe('writeSSREntry', () => {
	it('generates SSR handler code', () => {
		const result = writeSSREntry()
		expect(result).toContain(
			"export { prerender, resume, ssr } from '@jk2908/solas/env/ssr'",
		)
	})

	it('snapshot', () => {
		expect(writeSSREntry()).toMatchSnapshot()
	})
})

describe('writeBrowserEntry', () => {
	it('generates browser init code', () => {
		const result = writeBrowserEntry()
		expect(result).toContain("import { browser } from '@jk2908/solas/env/browser'")
		expect(result).toContain('browser()')
	})

	it('snapshot', () => {
		expect(writeBrowserEntry()).toMatchSnapshot()
	})
})

describe('writeCloudflareEntry', () => {
	it('delegates worker behaviour to the typed createWorker helper', () => {
		const result = writeCloudflareEntry()

		expect(result).toContain("import { createWorker } from '@jk2908/solas/cloudflare'")
		expect(result).toContain(
			'export default createWorker({ config, manifest, importMap })',
		)
		expect(result).not.toContain('Runtime')
	})

	it('snapshot', () => {
		expect(writeCloudflareEntry()).toMatchSnapshot()
	})
})
