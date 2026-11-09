import { describe, expect, it } from 'vitest'

import type { Manifest } from '../../../../src/types.js'
import { writeTypes } from '../../../../src/internal/codegen/types.js'
import { createEndpoint, createSegment } from '../../../utils.js'

describe('writeTypes', () => {
	it('generates Routes interface with page routes', () => {
		const manifest: Manifest = {
			'/about': [createSegment('/about')],
			'/': createSegment('/'),
		}
		const result = writeTypes(manifest)
		expect(result).toContain("declare module '@jk2908/solas'")
		expect(result).toContain('export namespace Solas')
		expect(result).toContain('Routes')
		expect(result).toContain("declare module 'virtual:solas-dev-client-css'")
	})

	it('includes params for dynamic routes', () => {
		const manifest: Manifest = {
			'/posts/:id': createSegment('/posts/:id', { __params: ['id'] }),
		}
		const result = writeTypes(manifest)
		expect(result).toContain('params')
		expect(result).toContain('id: string')
	})

	it('skips non-page entries', () => {
		const manifest: Manifest = {
			'/api/data': createEndpoint('/api/data'),
		}
		const result = writeTypes(manifest)
		expect(result).not.toContain('/api/data')
	})

	it('sorts routes by path', () => {
		const manifest: Manifest = {
			'/z': createSegment('/z'),
			'/a': createSegment('/a'),
		}
		const result = writeTypes(manifest)
		const aIdx = result.indexOf("'/a'")
		const zIdx = result.indexOf("'/z'")
		expect(aIdx).toBeLessThan(zIdx)
	})

	it('snapshot: empty manifest', () => {
		expect(writeTypes({})).toMatchSnapshot()
	})

	it('snapshot: mixed static and dynamic routes', () => {
		const manifest: Manifest = {
			'/': createSegment('/'),
			'/about': createSegment('/about'),
			'/posts/:id': createSegment('/posts/:id', { __params: ['id'] }),
			'/docs/*': createSegment('/docs/*', { __params: ['slug'], wildcard: true }),
		}
		expect(writeTypes(manifest)).toMatchSnapshot()
	})

	it('snapshot: route with multiple params', () => {
		const manifest: Manifest = {
			'/:lang/posts/:id': createSegment('/:lang/posts/:id', {
				__params: ['lang', 'id'],
			}),
		}
		expect(writeTypes(manifest)).toMatchSnapshot()
	})
})
