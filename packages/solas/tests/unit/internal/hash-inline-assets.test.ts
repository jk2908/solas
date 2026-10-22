import { describe, expect, it } from 'vitest'

import { hashInlineAssets } from '../../../src/internal/hash-inline-assets.js'

describe('hashInlineAssets', () => {
	it('hashes inline scripts and styles', () => {
		expect(
			hashInlineAssets(
				'<script>console.log("hi")</script><style>body { color: red }</style>',
			),
		).toEqual({
			script: ["'sha256-TMFma7PHrBUjZEUKY/MwBLuX3/HrQe2+A1FmjMS7ppA='"],
			style: ["'sha256-kl6HQb5peP+QG0x7FWklMRxR/HYq4xozK9Oa6BWSDQA='"],
		})
	})

	it('ignores comments and unrelated tags', () => {
		expect(
			hashInlineAssets(
				'<!-- <script>bad()</script> --><div data-x="<script>bad()</script>"></div>',
			),
		).toEqual({ script: [], style: [] })
	})

	it('handles uppercase tags and attributes containing >', () => {
		expect(hashInlineAssets('<SCRIPT data-x=">">console.log("hi")</SCRIPT>')).toEqual({
			script: ["'sha256-TMFma7PHrBUjZEUKY/MwBLuX3/HrQe2+A1FmjMS7ppA='"],
			style: [],
		})
	})

	it('deduplicates identical bodies', () => {
		expect(
			hashInlineAssets(
				'<script>console.log("hi")</script><script>console.log("hi")</script>',
			),
		).toEqual({
			script: ["'sha256-TMFma7PHrBUjZEUKY/MwBLuX3/HrQe2+A1FmjMS7ppA='"],
			style: [],
		})
	})

	it('normalises line endings before hashing', () => {
		expect(hashInlineAssets('<script>a\r\nb</script>')).toEqual(
			hashInlineAssets('<script>a\nb</script>'),
		)
	})

	it('does not treat a literal < in text as a tag', () => {
		expect(hashInlineAssets('<p>1 < 2</p><script>console.log("hi")</script>')).toEqual({
			script: ["'sha256-TMFma7PHrBUjZEUKY/MwBLuX3/HrQe2+A1FmjMS7ppA='"],
			style: [],
		})
	})

	it('does not hash an unterminated raw text element', () => {
		expect(hashInlineAssets('<script>console.log("hi")')).toEqual({
			script: [],
			style: [],
		})
	})
})
