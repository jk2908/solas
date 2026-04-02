import { Solas } from '../../solas'

import {
	AUTOGEN_MSG,
	toIdentifier,
	toIdentifierList,
	toRelativeModuleSpecifier,
} from './utils'

import type { Build } from '../build'

/**
 * Generates the import map for all route components, endpoints, layouts, shells, and middlewares
 */
export function writeMaps(imports: Build.Imports, modules: Build.Modules) {
	const statics = [
		...imports.endpoints.static.entries().map(([k, v]) => {
			const [, method] = k.split('_')

			return `import { ${toIdentifier(method.toUpperCase(), `endpoint export for ${k}`)} as ${toIdentifier(k, `endpoint alias for ${v}`)} } from ${toRelativeModuleSpecifier(v, `endpoint import for ${k}`)}`.trim()
		}),
		...imports.components.static
			.entries()
			.map(([k, v]) =>
				`import * as ${toIdentifier(k, `component alias for ${v}`)} from ${toRelativeModuleSpecifier(v, `component import for ${k}`)}`.trim(),
			),
		...imports.middlewares.static
			.entries()
			.map(([k, v]) =>
				`import { middleware as ${toIdentifier(k, `middleware alias for ${v}`)} } from ${toRelativeModuleSpecifier(v, `middleware import for ${k}`)}`.trim(),
			),
	]

	const dynamics = [
		...imports.components.dynamic
			.entries()
			.map(([k, v]) =>
				`export const ${toIdentifier(k, `dynamic component alias for ${v}`)} = () => import(${toRelativeModuleSpecifier(v, `dynamic import for ${k}`)})`.trim(),
			),
	]

	const map = Object.entries(modules).map(([id, m]) => {
		const parts: string[] = []

		if (m.shellId) parts.push(`shell: ${toIdentifier(m.shellId, `shell id for ${id}`)}`)

		if (m.layoutIds?.length) {
			const layouts = toIdentifierList(m.layoutIds, `layouts for ${id}`)
			parts.push(`layouts: [${layouts}]`)
		}

		if (m.pageId) parts.push(`page: ${toIdentifier(m.pageId, `page id for ${id}`)}`)
		if (m.endpointId) {
			parts.push(`endpoint: ${toIdentifier(m.endpointId, `endpoint id for ${id}`)}`)
		}

		if (m['401Ids']?.length) {
			const unauthorized = toIdentifierList(m['401Ids'], `401s for ${id}`)
			parts.push(`'401s': [${unauthorized}]`)
		}

		if (m['403Ids']?.length) {
			const forbidden = toIdentifierList(m['403Ids'], `403s for ${id}`)
			parts.push(`'403s': [${forbidden}]`)
		}

		if (m['404Ids']?.length) {
			const notFounds = toIdentifierList(m['404Ids'], `404s for ${id}`)
			parts.push(`'404s': [${notFounds}]`)
		}

		if (m['500Ids']?.length) {
			const serverErrors = toIdentifierList(m['500Ids'], `500s for ${id}`)
			parts.push(`'500s': [${serverErrors}]`)
		}

		if (m.loadingIds?.length) {
			const loaders = toIdentifierList(m.loadingIds, `loaders for ${id}`)
			parts.push(`loaders: [${loaders}]`)
		}

		if (m.middlewareIds?.length) {
			const middleware = toIdentifierList(m.middlewareIds, `middlewares for ${id}`)
			parts.push(`middlewares: [${middleware}]`)
		}

		return `${JSON.stringify(id)}: { ${parts.join(', ')} }`
	})

	return `
	  ${AUTOGEN_MSG}

		import type { ImportMap } from '${Solas.Config.PKG_NAME}'

	  ${statics.join('\n')}
		
	  ${dynamics.join('\n')}

		export const importMap = {
			${map.join(',\n')}
		} as const satisfies ImportMap
	`
}
