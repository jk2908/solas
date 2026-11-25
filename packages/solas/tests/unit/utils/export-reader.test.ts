import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('node:fs/promises', () => ({
	default: {
		readFile: vi.fn(),
	},
}))

import fs from 'node:fs/promises'

import { ExportReader } from '../../../src/utils/export-reader.js'

const mockReadFile = vi.mocked(fs.readFile)

describe('ExportReader', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe('raw', () => {
		it('reads file content', async () => {
			mockReadFile.mockResolvedValue('export const x = 1')
			const reader = new ExportReader()
			const result = await reader.raw('/test/file.ts')
			expect(result).toBe('export const x = 1')
		})

		it('throws when file does not exist', async () => {
			mockReadFile.mockRejectedValue(new Error('ENOENT'))
			const reader = new ExportReader()
			await expect(reader.raw('/missing.ts')).rejects.toThrow('ENOENT')
		})
	})

	describe('exports', () => {
		it('returns named exports from a module', async () => {
			mockReadFile.mockResolvedValue('export const foo = 1\nexport function bar() {}')
			const reader = new ExportReader()
			const names = await reader.exports('/test/file.ts')
			expect(names).toContain('foo')
			expect(names).toContain('bar')
		})

		it('excludes type exports', async () => {
			mockReadFile.mockResolvedValue('export type Foo = string\nexport const bar = 1')
			const reader = new ExportReader()
			const names = await reader.exports('/test/file.ts')
			expect(names).not.toContain('Foo')
			expect(names).toContain('bar')
		})

		it('returns empty array for file with no exports', async () => {
			mockReadFile.mockResolvedValue('const x = 1')
			const reader = new ExportReader()
			const names = await reader.exports('/test/file.ts')
			expect(names).toEqual([])
		})

		it('deduplicates export names', async () => {
			mockReadFile.mockResolvedValue(
				'export { foo } from "./a"\nexport { foo } from "./b"',
			)
			const reader = new ExportReader()
			const names = await reader.exports('/test/file.ts')
			expect(names.filter(n => n === 'foo')).toHaveLength(1)
		})
	})

	describe('has', () => {
		it('returns true when export exists', async () => {
			mockReadFile.mockResolvedValue('export const metadata = {}')
			const reader = new ExportReader()
			expect(await reader.has('/test/file.ts', 'metadata')).toBe(true)
		})

		it('returns false when export does not exist', async () => {
			mockReadFile.mockResolvedValue('export const foo = 1')
			const reader = new ExportReader()
			expect(await reader.has('/test/file.ts', 'metadata')).toBe(false)
		})
	})

	describe('literal', () => {
		it('reads string literal exports', async () => {
			mockReadFile.mockResolvedValue("export const title = 'Hello World'")
			const reader = new ExportReader()
			const result = await reader.literal('/test/file.ts', 'title')
			expect(result).toBe('Hello World')
		})

		it('reads number literal exports', async () => {
			mockReadFile.mockResolvedValue('export const count = 42')
			const reader = new ExportReader()
			const result = await reader.literal('/test/file.ts', 'count')
			expect(result).toBe(42)
		})

		it('reads boolean literal exports', async () => {
			mockReadFile.mockResolvedValue('export const flag = true')
			const reader = new ExportReader()
			const result = await reader.literal('/test/file.ts', 'flag')
			expect(result).toBe(true)
		})

		it('reads null literal exports', async () => {
			mockReadFile.mockResolvedValue('export const empty = null')
			const reader = new ExportReader()
			const result = await reader.literal('/test/file.ts', 'empty')
			expect(result).toBeNull()
		})

		it('reads negative number literals', async () => {
			mockReadFile.mockResolvedValue('export const neg = -10')
			const reader = new ExportReader()
			const result = await reader.literal('/test/file.ts', 'neg')
			expect(result).toBe(-10)
		})

		it('reads template literal without expressions', async () => {
			mockReadFile.mockResolvedValue('export const msg = `hello world`')
			const reader = new ExportReader()
			const result = await reader.literal('/test/file.ts', 'msg')
			expect(result).toBe('hello world')
		})

		it('returns undefined for non-existent export', async () => {
			mockReadFile.mockResolvedValue('export const foo = 1')
			const reader = new ExportReader()
			const result = await reader.literal('/test/file.ts', 'missing')
			expect(result).toBeUndefined()
		})

		it('returns undefined for non-literal exports', async () => {
			mockReadFile.mockResolvedValue('export const obj = { key: "value" }')
			const reader = new ExportReader()
			const result = await reader.literal('/test/file.ts', 'obj')
			expect(result).toBeUndefined()
		})

		it('applies validator when provided', async () => {
			mockReadFile.mockResolvedValue("export const title = 'Hello'")
			const reader = new ExportReader()
			const isString = (v: unknown): v is string => typeof v === 'string'
			const result = await reader.literal('/test/file.ts', 'title', isString)
			expect(result).toBe('Hello')
		})

		it('returns undefined when validator fails', async () => {
			mockReadFile.mockResolvedValue('export const count = 42')
			const reader = new ExportReader()
			const isString = (v: unknown): v is string => typeof v === 'string'
			const result = await reader.literal('/test/file.ts', 'count', isString)
			expect(result).toBeUndefined()
		})
	})

	describe('loadModule', () => {
		it('can be set', () => {
			const reader = new ExportReader()
			const mockLoader = vi.fn()
			reader.loadModule = mockLoader
		})
	})

	describe('parser language detection', () => {
		it.each([
			['/file.ts', 'ts'],
			['/file.tsx', 'tsx'],
			['/file.js', 'js'],
			['/file.jsx', 'jsx'],
			['/file.mts', 'ts'],
			['/file.cts', 'ts'],
			['/file.mjs', 'js'],
			['/file.cjs', 'js'],
		])('detects %s as %s', async (filePath, _expected) => {
			mockReadFile.mockResolvedValue('export const x = 1')
			const reader = new ExportReader()
			const names = await reader.exports(filePath)
			expect(names).toContain('x')
		})

		it('throws for unsupported extensions', async () => {
			mockReadFile.mockResolvedValue('export const x = 1')
			const reader = new ExportReader()
			await expect(reader.exports('/file.py')).rejects.toThrow(
				'unsupported module extension',
			)
		})
	})
})
