import { describe, it, expect } from 'vitest'

import { nodeAssets } from '../../../src/internal/assets.js'

describe('nodeAssets', () => {
	it('reports missing files', async () => {
		expect(
			await nodeAssets.exists({ namespace: 'client', path: 'not/a/real/file.txt' }),
		).toBe(false)
	})

	it('exposes a mime type lookup', () => {
		expect(nodeAssets.mimeType?.('/app.js')).toContain('text/javascript')
	})
})
