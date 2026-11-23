import { describe, expect, it } from 'vitest'

import { validatePprLayout } from '../../../src/internal/ppr-dynamic-validation.js'

const importDynamic = "import { dynamic } from '@jk2908/solas/server'\n"

describe('validatePprLayout', () => {
	it('allows unconditional dynamic calls', () => {
		expect(
			validatePprLayout(
				'layout.tsx',
				`${importDynamic}export default async function Layout() { await dynamic(); return null }`,
			),
		).toEqual([])
	})

	it('rejects dynamic calls in conditionals', () => {
		const errors = validatePprLayout(
			'layout.tsx',
			`${importDynamic}export default async function Layout({ show }) { if (show) { await dynamic() } return null }`,
		)

		expect(errors.join('\n')).toContain('prerender = false')
	})

	it('rejects dynamic calls in logical branches', () => {
		const errors = validatePprLayout(
			'layout.tsx',
			`${importDynamic}export default async function Layout({ show }) { await (show && dynamic()); return null }`,
		)

		expect(errors).toHaveLength(1)
	})
})
