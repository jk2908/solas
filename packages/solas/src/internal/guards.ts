import path from 'node:path'

import type { Plugin } from 'vite'

import { Logger } from '../utils/logger.js'

const logger = new Logger()

/**
 * Build features a platform may not support, as flags so they combine:
 * `Features.Actions | Features.Endpoints`.
 */
export const Features = {
	None: 0,
	Actions: 1 << 0,
	Endpoints: 1 << 1,
	All: (1 << 0) | (1 << 1),
} as const

export type Feature = (typeof Features)[keyof typeof Features]

const LABEL: Record<number, string> = {
	[Features.Actions]: 'a server action',
	[Features.Endpoints]: 'a runtime endpoint',
}

const SOURCE = /\.(m?[jt]sx?)$/
const ENDPOINT = /\+endpoint\.m?[jt]sx?$/
const USE_SERVER = /^\s*['"]use server['"]/m

/**
 * Build guards, installed by an adapter: warns when the build graph uses a
 * feature the adapter does not support. `supports` is a set of `Features` flags
 * (`Features.Actions | Features.Endpoints`), defaulting to `Features.All`.
 */
export function guards(supports: Feature = Features.All) {
	const cwd = process.cwd()
	const warned = new Set<string>()

	return {
		name: 'solas:guards',
		enforce: 'pre',
		transform(code, id) {
			const file = id.split('?')[0]

			if (!path.isAbsolute(file) || !file.startsWith(cwd) || warned.has(file)) return
			if (!SOURCE.test(file)) return

			let feature: Feature | undefined

			if (ENDPOINT.test(file)) {
				feature = Features.Endpoints
			} else if (USE_SERVER.test(code)) {
				feature = Features.Actions
			}

			if (feature === undefined || (supports & feature) !== 0) return

			warned.add(file)
			logger.warn(
				`[build] this build uses ${LABEL[feature]} (${path.relative(cwd, file)}), ` +
					`which the adapter does not support`,
			)
		},
	} satisfies Plugin
}
