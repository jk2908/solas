import path from 'node:path'

export class ExportReader {
	readonly #transpilers = new Map<
		ExportReader.Loader,
		InstanceType<typeof Bun.Transpiler>
	>()

	/**
	 * Pick the Bun loader that matches the source file extension
	 */
	static #getLoader(filePath: string): ExportReader.Loader {
		const ext = path.extname(filePath).toLowerCase()

		if (ext === '.js' || ext === '.mjs' || ext === '.cjs') return 'js'
		if (ext === '.jsx') return 'jsx'
		if (ext === '.ts' || ext === '.mts' || ext === '.cts') return 'ts'
		if (ext === '.tsx') return 'tsx'

		throw new Error(`Unsupported module extension: ${ext || '(none)'} in ${filePath}`)
	}

	/**
	 * Reuse one transpiler per supported loader so scans match the module syntax
	 */
	#getTranspiler(filePath: string) {
		const loader = ExportReader.#getLoader(filePath)
		const cached = this.#transpilers.get(loader)
		if (cached) return cached

		const transpiler = new Bun.Transpiler({ loader })
		this.#transpilers.set(loader, transpiler)

		return transpiler
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
		const mod = (await import(/* @vite-ignore */ abs)) as Record<string, unknown>
		const value = mod[name]

		if (value === undefined) return
		if (!validate || validate(value)) return value as T
	}
}

export namespace ExportReader {
	export type Loader = 'js' | 'jsx' | 'ts' | 'tsx'
	export type Validator<T> = (value: unknown) => value is T
}
