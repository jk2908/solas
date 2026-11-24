import { parseSync } from 'oxc-parser'

import * as Config from '../config.js'

// oxc-parser exposes a JSON AST without types, so probe only the keys we need
type AstNode = Record<string, any>

/**
 * Reject conditional dynamic() calls in PPR layout modules.
 *
 * This is a static guard, not a runtime check. It checks direct calls and
 * calls through local helper functions; imported helpers still need code review.
 */
export function validatePprLayout(file: string, source: string) {
	const parsed = parseSync(file, source)
	const dynamicNames = new Set<string>()
	const namespaceNames = new Set<string>()

	for (const statement of parsed.program.body as AstNode[]) {
		if (statement.type !== 'ImportDeclaration') continue
		if (statement.source?.value !== `${Config.PKG_NAME}/server`) continue

		for (const specifier of statement.specifiers as AstNode[]) {
			if (
				specifier.type === 'ImportSpecifier' &&
				specifier.imported?.name === 'dynamic'
			) {
				dynamicNames.add(specifier.local.name)
			}

			if (specifier.type === 'ImportNamespaceSpecifier') {
				namespaceNames.add(specifier.local.name)
			}
		}
	}

	if (dynamicNames.size === 0 && namespaceNames.size === 0) return []

	const errors: string[] = []

	function isDynamicCall(callee: AstNode) {
		if (callee.type === 'Identifier') return dynamicNames.has(callee.name)
		if (callee.type !== 'MemberExpression') return false
		if (callee.computed) return false
		if (callee.property?.name !== 'dynamic') return false
		return callee.object?.type === 'Identifier' && namespaceNames.has(callee.object.name)
	}

	type FunctionInfo = {
		calls: Set<string>
		dynamic: boolean
	}

	const functions = new Map<string, FunctionInfo>()
	const functionBodies = new Map<string, unknown>()

	function addFunction(name: string | undefined, body: unknown) {
		if (!name || !body || typeof body !== 'object') return
		if (functions.has(name)) return
		functions.set(name, { calls: new Set(), dynamic: false })
		functionBodies.set(name, body)
	}

	function collectFunctions(value: unknown) {
		if (!value || typeof value !== 'object') return
		if (Array.isArray(value)) {
			for (const child of value) collectFunctions(child)
			return
		}

		const node = value as AstNode

		if (node.type === 'FunctionDeclaration') {
			addFunction(node.id?.name, node.body)
		}

		if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier') {
			if (
				node.init?.type === 'ArrowFunctionExpression' ||
				node.init?.type === 'FunctionExpression'
			) {
				addFunction(node.id.name, node.init.body)
			}
		}

		for (const key of Object.keys(node)) {
			if (key === 'type' || key === 'loc' || key === 'start' || key === 'end') continue
			collectFunctions(node[key])
		}
	}

	function collectCalls(value: unknown, info: FunctionInfo) {
		if (!value || typeof value !== 'object') return
		if (Array.isArray(value)) {
			for (const child of value) collectCalls(child, info)
			return
		}

		const node = value as AstNode

		if (node.type === 'CallExpression') {
			if (isDynamicCall(node.callee)) info.dynamic = true
			else if (
				node.callee?.type === 'Identifier' &&
				typeof node.callee.name === 'string'
			) {
				info.calls.add(node.callee.name)
			}
		}

		for (const key of Object.keys(node)) {
			if (key === 'type' || key === 'loc' || key === 'start' || key === 'end') continue
			collectCalls(node[key], info)
		}
	}

	function isDynamicHelperCall(callee: AstNode) {
		if (callee.type !== 'Identifier') return false
		return functions.get(callee.name)?.dynamic === true
	}

	collectFunctions(parsed.program)

	for (const [name, info] of functions) {
		const body = functionBodies.get(name)
		if (body) collectCalls(body, info)
	}

	let changed = true

	while (changed) {
		changed = false

		for (const info of functions.values()) {
			if (info.dynamic) continue
			if ([...info.calls].some(name => functions.get(name)?.dynamic)) {
				info.dynamic = true
				changed = true
			}
		}
	}

	function visit(value: unknown, conditional: boolean) {
		if (!value || typeof value !== 'object') return
		if (Array.isArray(value)) {
			for (const child of value) visit(child, conditional)
			return
		}

		const node = value as AstNode

		if (
			node.type === 'CallExpression' &&
			conditional &&
			(isDynamicCall(node.callee) || isDynamicHelperCall(node.callee))
		) {
			errors.push(
				`${file}: dynamic() is conditional in a PPR layout. ` +
					'Use `export const prerender = false` for this route or move the dynamic work to the page.',
			)
		}

		if (node.type === 'IfStatement') {
			visit(node.test, conditional)
			visit(node.consequent, true)
			visit(node.alternate, true)
			return
		}

		if (node.type === 'ConditionalExpression') {
			visit(node.test, conditional)
			visit(node.consequent, true)
			visit(node.alternate, true)
			return
		}

		if (node.type === 'LogicalExpression') {
			visit(node.left, conditional)
			visit(node.right, true)
			return
		}

		if (node.type === 'SwitchStatement') {
			visit(node.discriminant, conditional)
			for (const item of node.cases ?? []) visit(item, true)
			return
		}

		if (
			node.type === 'ForStatement' ||
			node.type === 'ForInStatement' ||
			node.type === 'ForOfStatement' ||
			node.type === 'WhileStatement' ||
			node.type === 'DoWhileStatement'
		) {
			for (const key of Object.keys(node)) {
				if (key === 'type' || key === 'body') continue
				visit(node[key], conditional)
			}
			visit(node.body, true)
			return
		}

		if (node.type === 'TryStatement') {
			visit(node.block, conditional)
			visit(node.handler, true)
			visit(node.finalizer, conditional)
			return
		}

		for (const key of Object.keys(node)) {
			if (key === 'type' || key === 'loc' || key === 'start' || key === 'end') {
				continue
			}
			visit(node[key], conditional)
		}
	}

	visit(parsed.program, false)

	return [...new Set(errors)]
}
