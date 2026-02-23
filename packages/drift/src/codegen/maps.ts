import { Config } from '../config'

import type { Imports, Modules } from '../build'

import { AUTOGEN_MSG } from './utils'

export function writeMaps(imports: Imports, modules: Modules) {
	const statics = [
		...imports.endpoints.static.entries().map(([k, v]) => {
			const [, method] = k.split('_')

			return `import { ${method.toUpperCase()} as ${k}} from ${JSON.stringify(v)}`.trim()
		}),
		...imports.components.static
			.entries()
			.map(([k, v]) => `import * as ${k} from ${JSON.stringify(v)}`.trim()),
		...imports.middlewares.static
			.entries()
			.map(([k, v]) => `import { middleware as ${k} } from ${JSON.stringify(v)}`.trim()),
	]

	const dynamics = [
		...imports.components.dynamic
			.entries()
			.map(([k, v]) => `export const ${k} = () => import(${JSON.stringify(v)})`.trim()),
	]

	const map = Object.entries(modules).map(([id, m]) => {
		const parts: string[] = []

		if (m.shellId) parts.push(`shell: ${m.shellId}`)

		if (m.layoutIds?.length) {
			const layouts = m.layoutIds.map(id => (id === null ? 'null' : id)).join(', ')
			parts.push(`layouts: [${layouts}]`)
		}

		if (m.pageId) parts.push(`page: ${m.pageId}`)
		if (m.endpointId) parts.push(`endpoint: ${m.endpointId}`)

		if (m['404Ids']?.length) {
			const notFounds = m['404Ids'].map(id => (id === null ? 'null' : id)).join(', ')
			parts.push(`'404s': [${notFounds}]`)
		}

		if (m.loadingIds?.length) {
			const loaders = m.loadingIds.map(id => (id === null ? 'null' : id)).join(', ')
			parts.push(`loaders: [${loaders}]`)
		}

		if (m.middlewareIds?.length) {
			const middleware = m.middlewareIds.map(id => (id === null ? 'null' : id)).join(', ')
			parts.push(`middlewares: [${middleware}]`)
		}

		return `${JSON.stringify(id)}: { ${parts.join(', ')} }`
	})

	return `
	  ${AUTOGEN_MSG}

		import type { ImportMap } from '${Config.PKG_NAME}'

	  ${statics.join('\n')}
		
	  ${dynamics.join('\n')}

		export const importMap = {
			${map.join(',\n')}
		} as const satisfies ImportMap
	`
}
