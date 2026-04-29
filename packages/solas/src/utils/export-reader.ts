import path from 'node:path'

import type { ViteDevServer } from 'vite'

export class ExportReader {
	readonly #transpilers = new Map<
		ExportReader.LoaderType,
		InstanceType<typeof Bun.Transpiler>
	>()

	#loadModule: ViteDevServer['ssrLoadModule'] | null = null

	/**
	 * Pick the Bun loader type that matches the source file extension
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
	 * Parse a literal value from a string
	 */
	static #parse(value: string) {
		const trimmed = value.trim()

		// keep quoted literals as strings without evaluating the
		// source text
		if (
			(trimmed.startsWith('"') && trimmed.endsWith('"')) ||
			(trimmed.startsWith("'") && trimmed.endsWith("'")) ||
			(trimmed.startsWith('`') && trimmed.endsWith('`'))
		) {
			return trimmed.slice(1, -1)
		}

		if (trimmed === 'true') return true
		if (trimmed === 'false') return false
		if (trimmed === 'null') return null

		const n = Number(trimmed)
		if (Number.isFinite(n)) return n
	}

	/**
	 * Set the Vite server's SSR module loader so we can execute modules
	 */
	set loadModule(l: ViteDevServer['ssrLoadModule']) {
		this.#loadModule = l
	}

	/**
	 * Reuse one transpiler per supported loader so scans match the module syntax
	 */
	#getTranspiler(filePath: string) {
		const type = ExportReader.#getLoaderType(filePath)
		const cached = this.#transpilers.get(type)
		if (cached) return cached

		const transpiler = new Bun.Transpiler({ loader: type })
		this.#transpilers.set(type, transpiler)

		return transpiler
	}

	/**
	 * Read the raw text content of a file
	 */
	async raw(filePath: string) {
		return Bun.file(filePath).text()
	}

	/**
	 * Get the names of all exports from a file
	 */
	async exports(filePath: string) {
		// use Bun's transpiler scan so we can inspect export names
		// without loading the module
		return this.#getTranspiler(filePath).scan(await this.raw(filePath)).exports
	}

	/**
	 * Check if a file exports a specific name
	 */
	async has(filePath: string, name: string) {
		const names = await this.exports(filePath)
		return names.includes(name)
	}

	/**
	 * Read a simple literal export from a file without executing it
	 * @description supports string, number, boolean, and null literals.
	 * The export must be in the form of `export const|let|var name = <literal>`
	 */
	async literal<T>(filePath: string, name: string, validate?: ExportReader.Validator<T>) {
		const code = await this.raw(filePath)

		// build the matcher from escaped plain-text pieces so arbitrary export names
		// cannot change the regex shape
		const source =
			// match: `export const|let|var `
			'\\bexport\\s+(?:const|let|var)\\s+' +
			// treat export name as plain text in regex
			name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
			// capture one supported literal value (string, number, boolean, null)
			'\\s*=\\s*(?<value>(?:"(?:[^"\\\\]|\\\\.)*"|\'(?:[^\'\\\\]|\\\\.)*\'|\\x60(?:[^\\x60\\\\]|\\\\.)*\\x60|true|false|null|-?\\d+(?:\\.\\d+)?))(?=\\s|;|$)'

		const text = code.match(new RegExp(source))?.groups?.value
		if (!text) return

		// only support cheap literal parsing here. Anything richer should go through
		// value() so module semantics stay correct
		const value = ExportReader.#parse(text)

		if (value === undefined) return
		if (!validate || validate(value)) return value as T
	}

	/**
	 * Read an export from a file by executing the module
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
}

export namespace ExportReader {
	export type LoaderType = 'js' | 'jsx' | 'ts' | 'tsx'
	export type Validator<T> = (value: unknown) => value is T
}
