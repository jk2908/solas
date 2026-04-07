import type { Build } from '../build.js'
import { Solas } from '../../solas.js'
import {
	AUTOGEN_MSG,
	indent,
	source,
	toIdentifier,
	toIdentifierList,
	toRelativeModuleSpecifier,
	toStringLiteral,
} from './utils.js'

/**
 * Generates the import map for all route components, endpoints, layouts, shells, and middlewares
 */
export function writeMaps(imports: Build.Imports, modules: Build.Modules) {
	const statics = [
		...imports.endpoints.static.entries().map(([k, v]) => {
			const [, method] = k.split('_')

			return `import { ${toIdentifier(method.toUpperCase(), `endpoint export for ${k}`)} as ${toIdentifier(k, `endpoint alias for ${v}`)} } from ${toRelativeModuleSpecifier(v, `endpoint import for ${k}`)}`
		}),
		...imports.components.static
			.entries()
			.map(
				([k, v]) =>
					`import * as ${toIdentifier(k, `component alias for ${v}`)} from ${toRelativeModuleSpecifier(v, `component import for ${k}`)}`,
			),
		...imports.middlewares.static
			.entries()
			.map(
				([k, v]) =>
					`import { middleware as ${toIdentifier(k, `middleware alias for ${v}`)} } from ${toRelativeModuleSpecifier(v, `middleware import for ${k}`)}`,
			),
	]

	const dynamics = [
		...imports.components.dynamic
			.entries()
			.map(
				([k, v]) =>
					`export const ${toIdentifier(k, `dynamic component alias for ${v}`)} = () => import(${toRelativeModuleSpecifier(v, `dynamic import for ${k}`)})`,
			),
	]

	const map = Object.entries(modules).map(([moduleId, m]) => {
		const parts: string[] = []

		if (m.shellId) {
			parts.push(`shell: ${toIdentifier(m.shellId, `shell id for ${moduleId}`)}`)
		}

		if (m.layoutIds?.length) {
			const layouts = toIdentifierList(m.layoutIds, `layouts for ${moduleId}`)
			parts.push(`layouts: [${layouts}]`)
		}

		if (m.pageId) {
			parts.push(`page: ${toIdentifier(m.pageId, `page id for ${moduleId}`)}`)
		}
		if (m.endpointId) {
			parts.push(`endpoint: ${toIdentifier(m.endpointId, `endpoint id for ${moduleId}`)}`)
		}

		if (m['401Ids']?.length) {
			const unauthorized = toIdentifierList(m['401Ids'], `401s for ${moduleId}`)
			parts.push(`'401s': [${unauthorized}]`)
		}

		if (m['403Ids']?.length) {
			const forbidden = toIdentifierList(m['403Ids'], `403s for ${moduleId}`)
			parts.push(`'403s': [${forbidden}]`)
		}

		if (m['404Ids']?.length) {
			const notFounds = toIdentifierList(m['404Ids'], `404s for ${moduleId}`)
			parts.push(`'404s': [${notFounds}]`)
		}

		if (m['500Ids']?.length) {
			const serverErrors = toIdentifierList(m['500Ids'], `500s for ${moduleId}`)
			parts.push(`'500s': [${serverErrors}]`)
		}

		if (m.loadingIds?.length) {
			const loaders = toIdentifierList(m.loadingIds, `loaders for ${moduleId}`)
			parts.push(`loaders: [${loaders}]`)
		}

		if (m.middlewareIds?.length) {
			const middleware = toIdentifierList(m.middlewareIds, `middlewares for ${moduleId}`)
			parts.push(`middlewares: [${middleware}]`)
		}

		if (parts.length === 0) return `${toStringLiteral(moduleId)}: {}`

		return `${toStringLiteral(moduleId)}: {\n${parts.map(part => indent(part, 1)).join(',\n')}\n}`
	})

	const importLines = [...statics, ...dynamics].join('\n')
	const entries = map.map(entry => indent(entry, 1)).join(',\n')

	return source`
		${AUTOGEN_MSG}

		import type { ImportMap } from '${Solas.Config.PKG_NAME}'
${
	importLines
		? `
${importLines}`
		: ''
}

		export const importMap = {
${entries}
		} as const satisfies ImportMap
	`
}
