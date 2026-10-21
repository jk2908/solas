import { describe, expect, it } from 'vitest'

import { CspHash } from '../../../src/internal/csp-hash.js'

describe('CspHash.collect', () => {
	it('hashes inline scripts and styles', () => {
		expect(
			CspHash.collect(
				'<script>console.log("hi")</script><style>body { color: red }</style>',
			),
		).toEqual({
			script: ["'sha256-TMFma7PHrBUjZEUKY/MwBLuX3/HrQe2+A1FmjMS7ppA='"],
			style: ["'sha256-kl6HQb5peP+QG0x7FWklMRxR/HYq4xozK9Oa6BWSDQA='"],
		})
	})

	it('ignores comments and unrelated tags', () => {
		expect(
			CspHash.collect(
				'<!-- <script>bad()</script> --><div data-x="<script>bad()</script>"></div>',
			),
		).toEqual({ script: [], style: [] })
	})

	it('handles uppercase tags and attributes containing >', () => {
		expect(CspHash.collect('<SCRIPT data-x=">">console.log("hi")</SCRIPT>')).toEqual({
			script: ["'sha256-TMFma7PHrBUjZEUKY/MwBLuX3/HrQe2+A1FmjMS7ppA='"],
			style: [],
		})
	})

	it('deduplicates identical bodies', () => {
		expect(
			CspHash.collect(
				'<script>console.log("hi")</script><script>console.log("hi")</script>',
			),
		).toEqual({
			script: ["'sha256-TMFma7PHrBUjZEUKY/MwBLuX3/HrQe2+A1FmjMS7ppA='"],
			style: [],
		})
	})

	it('normalises line endings before hashing', () => {
		expect(CspHash.collect('<script>a\r\nb</script>')).toEqual(
			CspHash.collect('<script>a\nb</script>'),
		)
	})

	it('does not treat a literal < in text as a tag', () => {
		expect(CspHash.collect('<p>1 < 2</p><script>console.log("hi")</script>')).toEqual({
			script: ["'sha256-TMFma7PHrBUjZEUKY/MwBLuX3/HrQe2+A1FmjMS7ppA='"],
			style: [],
		})
	})

	it('does not hash an unterminated raw text element', () => {
		expect(CspHash.collect('<script>console.log("hi")')).toEqual({
			script: [],
			style: [],
		})
	})
})
