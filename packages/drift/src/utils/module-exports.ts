import path from 'node:path'

export namespace ModuleExports {
	export type Validator<T> = (value: unknown) => value is T

	export class Reader {
		constructor(
			public readonly transpiler: InstanceType<
				typeof Bun.Transpiler
			> = new Bun.Transpiler({ loader: 'tsx' }),
		) {}

		/**
		 * Parse a literal value from a string
		 */
		static #parse(value: string) {
			const trimmed = value.trim()

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

			return undefined
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
			return this.transpiler.scan(await this.raw(filePath)).exports
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
		async literal<T>(filePath: string, name: string, validate?: Validator<T>) {
			const code = await this.raw(filePath)

			const source =
				// match: `export const|let|var `
				'\\bexport\\s+(?:const|let|var)\\s+' +
				// treat export name as plain text in regex
				name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
				// capture one supported literal value (string, number, boolean, null)
				'\\s*=\\s*(?<value>(?:"(?:[^"\\\\]|\\\\.)*"|\'(?:[^\'\\\\]|\\\\.)*\'|\\x60(?:[^\\x60\\\\]|\\\\.)*\\x60|true|false|null|-?\\d+(?:\\.\\d+)?))(?=\\s|;|$)'

			const text = code.match(new RegExp(source))?.groups?.value
			if (!text) return

			const value = Reader.#parse(text)

			if (value === undefined) return
			if (!validate || validate(value)) return value as T
		}

		/**
		 * Read an export from a file by executing the module
		 */
		async value<T>(filePath: string, name: string, validate?: Validator<T>) {
			if (!(await this.has(filePath, name))) return

			const abs = path.resolve(process.cwd(), filePath)
			const mod = (await import(/* @vite-ignore */ abs)) as Record<string, unknown>
			const value = mod[name]

			if (value === undefined) return
			if (!validate || validate(value)) return value as T
		}
	}
}
