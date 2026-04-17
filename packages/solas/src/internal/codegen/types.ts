import { Solas } from '../../solas.js'
import { Manifest } from '../../types.js'
import { Build } from '../build.js'
import { AUTOGEN_MSG, source } from './utils.js'

function render(path: string, params?: string[]) {
	if (!params || params.length === 0) {
		return `\t\t\t'${path}': {}`
	}

	const fields = params.map(param => `\t\t\t\t\t${param}: string`).join('\n')

	return [`\t\t\t'${path}': {`, `\t\t\t\tparams: {`, fields, `\t\t\t\t}`, `\t\t\t}`].join(
		'\n',
	)
}

/**
 * Generates runtime types
 */
export function writeTypes(manifest: Manifest) {
	const routes = new Map<string, string[]>()

	for (const path in manifest) {
		const route = manifest[path]

		if (Array.isArray(route)) {
			for (const r of route) {
				if (r.__kind !== Build.EntryKind.PAGE) continue
				routes.set(r.__path, r.__params)
			}
		} else {
			if (route.__kind !== Build.EntryKind.PAGE) continue
			routes.set(route.__path, route.__params)
		}
	}

	const body = [...routes.entries()]
		// sort routes by path for stable output
		.toSorted(([a], [b]) => a.localeCompare(b))
		.map(([path, params]) => render(path, params))
		.join('\n')

	return source`
   ${AUTOGEN_MSG}

	 import '${Solas.Config.PKG_NAME}'

	 declare module '${Solas.Config.PKG_NAME}' {
		export namespace Solas {
			export interface Routes {
				${body}
			}
		}
	 }`
}
