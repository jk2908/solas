import fs from 'node:fs/promises'
import path from 'node:path'

import {
	parseSync,
	type Program,
	type StaticExport,
	type StaticExportEntry,
} from 'oxc-parser'

type ModuleLoader = (filePath: string) => Promise<Record<string, unknown>>

type LiteralValue = string | number | boolean | null

type LiteralNode = {
	type: 'Literal'
	value: LiteralValue
}

type TemplateLiteralNode = {
	type: 'TemplateLiteral'
	expressions: unknown[]
	quasis: Array<{ value?: { cooked?: string | null } }>
}

type UnaryExpressionNode = {
	type: 'UnaryExpression'
	operator: '-'
	argument: LiteralNode
}

export class ExportReader {
	#loadModule: ModuleLoader | null = null

	/**
	 * Pick the parser language that matches the source file extension.
	 */
	static #getLoaderType(filePath: string): ExportReader.LoaderType {
		const ext = path.extname(filePath).toLowerCase()

		if (ext === '.js' || ext === '.mjs' || ext === '.cjs') return 'js'
		if (ext === '.jsx') return 'jsx'
		if (ext === '.ts' || ext === '.mts' || ext === '.cts') return 'ts'
		if (ext === '.tsx') return 'tsx'

		throw new Error(`Unsupported module extension: ${ext || '(none)'} in ${filePath}`)
	}

	/**
	 * Set the module loader used to execute route modules.
	 */
	set loadModule(l: ModuleLoader) {
		this.#loadModule = l
	}

	/**
	 * Parse a source file as an ESM route module.
	 */
	async #parse(filePath: string) {
		const source = await this.raw(filePath)
		const result = parseSync(filePath, source, {
			lang: ExportReader.#getLoaderType(filePath),
			sourceType: 'module',
			preserveParens: false,
		})

		if (result.errors.length > 0) {
			throw new Error(result.errors[0]?.message ?? `Failed to parse ${filePath}`)
		}

		return result
	}

	/**
	 * Read the raw text content of a file.
	 */
	async raw(filePath: string) {
		return fs.readFile(filePath, 'utf-8')
	}

	/**
	 * Get the names of all exports from a file.
	 */
	async exports(filePath: string) {
		const { module } = await this.#parse(filePath)

		return Array.from(
			new Set(
				module.staticExports.flatMap((entry: StaticExport) =>
					entry.entries
						.filter((specifier: StaticExportEntry) => !specifier.isType)
						.map((specifier: StaticExportEntry) => specifier.exportName.name)
						.filter(
							(name: string | null): name is string =>
								typeof name === 'string' && name.length > 0,
						),
				),
			),
		)
	}

	/**
	 * Check if a file exports a specific name.
	 */
	async has(filePath: string, name: string) {
		const names = await this.exports(filePath)
		return names.includes(name)
	}

	/**
	 * Read a simple literal export from a file without executing it.
	 * @description Supports string, number, boolean, and null literals.
	 * The export must be in the form of `export const|let|var name = <literal>`.
	 */
	async literal<T>(filePath: string, name: string, validate?: ExportReader.Validator<T>) {
		if (!(await this.has(filePath, name))) return

		const { program } = await this.#parse(filePath)
		const value = ExportReader.#readLiteralExport(program, name)

		if (value === undefined) return
		if (!validate || validate(value)) return value as T
	}

	/**
	 * Read an export from a file by executing the module.
	 */
	async value<T>(filePath: string, name: string, validate?: ExportReader.Validator<T>) {
		if (!(await this.has(filePath, name))) return

		// resolve from the project root so generated/build-time callers can pass the
		// same workspace-relative paths used elsewhere in the route graph
		const abs = path.resolve(process.cwd(), filePath)
		const mod = this.#loadModule
			? await this.#loadModule(abs)
			: await import(/* @vite-ignore */ abs)

		const value = mod[name]

		if (value === undefined) return
		if (!validate || validate(value)) return value as T
	}

	static #readLiteralExport(program: Program, name: string) {
		for (const statement of program.body) {
			if (statement.type !== 'ExportNamedDeclaration') continue

			const declaration = statement.declaration
			if (!declaration || declaration.type !== 'VariableDeclaration') continue

			for (const declarator of declaration.declarations) {
				if (declarator.id.type !== 'Identifier' || declarator.id.name !== name) continue

				return ExportReader.#readLiteralValue(declarator.init)
			}
		}
	}

	static #readLiteralValue(value: unknown) {
		if (!value || typeof value !== 'object' || !('type' in value)) return

		const node = value as { type: string }

		if (node.type === 'Literal') {
			const literal = value as LiteralNode

			if (
				typeof literal.value === 'string' ||
				typeof literal.value === 'number' ||
				typeof literal.value === 'boolean' ||
				literal.value === null
			) {
				return literal.value
			}
		}

		if (
			node.type === 'TemplateLiteral' &&
			Array.isArray((value as TemplateLiteralNode).expressions) &&
			(value as TemplateLiteralNode).expressions.length === 0 &&
			Array.isArray((value as TemplateLiteralNode).quasis) &&
			(value as TemplateLiteralNode).quasis.length === 1
		) {
			const quasi = (value as TemplateLiteralNode).quasis[0]
			if (quasi?.value && typeof quasi.value.cooked === 'string') {
				return quasi.value.cooked
			}
		}

		if (
			node.type === 'UnaryExpression' &&
			(value as UnaryExpressionNode).operator === '-' &&
			(value as UnaryExpressionNode).argument.type === 'Literal' &&
			(value as UnaryExpressionNode).argument.value !== null &&
			typeof (value as UnaryExpressionNode).argument.value === 'number'
		) {
			const argument = (value as UnaryExpressionNode).argument.value as number
			return -argument
		}
	}
}

export namespace ExportReader {
	export type LoaderType = 'js' | 'jsx' | 'ts' | 'tsx'
	export type Validator<T> = (value: unknown) => value is T
}
