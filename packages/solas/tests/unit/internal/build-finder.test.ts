import type { Dirent } from 'node:fs'

import { describe, it, expect, vi, beforeEach } from 'vitest'

import type { BuildContext } from '../../../src/types.js'

vi.mock('node:fs/promises', () => ({
	default: {
		readdir: vi.fn(),
	},
}))

vi.mock('../../../src/utils/hash.js', () => ({
	hash: vi.fn((input: string) => {
		let hash = 0
		for (let i = 0; i < input.length; i++) {
			hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0
		}
		return Math.abs(hash).toString(36)
	}),
}))

import fs from 'node:fs/promises'

import { ExportReader } from '../../../src/utils/export-reader.js'

import { Finder } from '../../../src/internal/build.js'

const mockReaddir = vi.mocked(fs.readdir)

function dirent(name: string, isDir: boolean): Dirent {
	return {
		name,
		isFile: () => !isDir,
		isDirectory: () => isDir,
		isBlockDevice: () => false,
		isCharacterDevice: () => false,
		isSymbolicLink: () => false,
		isFIFO: () => false,
		isSocket: () => false,
		parentPath: '',
		path: '',
	} as Dirent
}

function createBuildContext(overrides: Partial<BuildContext> = {}): BuildContext {
	return {
		command: 'build',
		exportReader: Object.assign(new ExportReader(), {
			literal: vi.fn().mockResolvedValue(undefined),
			value: vi.fn().mockResolvedValue(undefined),
			has: vi.fn().mockResolvedValue(false),
			exports: vi.fn().mockResolvedValue([]),
		}),
		prerenderRoutes: new Set(),
		knownRoutes: new Set(),
		...overrides,
	}
}

describe('Finder', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe('run', () => {
		it('returns empty manifest when scan directory cannot be read', async () => {
			mockReaddir.mockRejectedValue(new Error('ENOENT'))

			const finder = new Finder(createBuildContext(), {})
			const result = await finder.run()
			expect(result).toEqual({
				manifest: {},
				imports: {
					endpoints: { static: expect.any(Map) },
					components: { static: expect.any(Map), dynamic: expect.any(Map) },
					middlewares: { static: expect.any(Map) },
				},
				modules: {},
				prerenderRoutes: expect.any(Set),
				knownRoutes: expect.any(Set),
			})
		})

		it('discovers a basic page with shell', async () => {
			mockReaddir.mockImplementation(async (dir: string) => {
				if (dir === 'app') {
					return [
						dirent('+layout.tsx', false),
						dirent('+page.tsx', false),
					] as unknown as Dirent[]
				}
				return [] as unknown as Dirent[]
			})

			const finder = new Finder(createBuildContext(), {})
			const result = await finder.run()

			expect(result.manifest['/']).toBeDefined()
			expect(result.knownRoutes.has('/')).toBe(true)
		})

		it('discovers nested pages', async () => {
			mockReaddir.mockImplementation(async (dir: string) => {
				if (dir === 'app') {
					return [
						dirent('+layout.tsx', false),
						dirent('+page.tsx', false),
						dirent('about', true),
					] as unknown as Dirent[]
				}
				if (dir === 'app/about') {
					return [dirent('+page.tsx', false)] as unknown as Dirent[]
				}
				return [] as unknown as Dirent[]
			})

			const finder = new Finder(createBuildContext(), {})
			const result = await finder.run()

			expect(result.manifest['/']).toBeDefined()
			expect(result.manifest['/about']).toBeDefined()
		})

		it('discovers error boundary files', async () => {
			mockReaddir.mockImplementation(async (dir: string) => {
				if (dir === 'app') {
					return [
						dirent('+layout.tsx', false),
						dirent('+404.tsx', false),
						dirent('+500.tsx', false),
						dirent('+page.tsx', false),
					] as unknown as Dirent[]
				}
				return [] as unknown as Dirent[]
			})

			const finder = new Finder(createBuildContext(), {})
			const result = await finder.run()

			const entry = result.manifest['/']
			expect(entry).toBeDefined()
			if (!Array.isArray(entry)) {
				expect(entry.paths['404s']?.[0]).toBeTruthy()
				expect(entry.paths['500s']?.[0]).toBeTruthy()
			}
		})

		it('discovers endpoint files', async () => {
			const exportReader = Object.assign(new ExportReader(), {
				literal: vi.fn().mockResolvedValue(undefined),
				value: vi.fn().mockResolvedValue(undefined),
				has: vi.fn().mockResolvedValue(false),
				exports: vi.fn().mockResolvedValue(['GET', 'POST']),
			})

			mockReaddir.mockImplementation(async (dir: string) => {
				if (dir === 'app') {
					return [
						dirent('+layout.tsx', false),
						dirent('api', true),
					] as unknown as Dirent[]
				}
				if (dir === 'app/api') {
					return [dirent('data', true)] as unknown as Dirent[]
				}
				if (dir === 'app/api/data') {
					return [dirent('+endpoint.ts', false)] as unknown as Dirent[]
				}
				return [] as unknown as Dirent[]
			})

			const finder = new Finder(createBuildContext({ exportReader }), {})
			const result = await finder.run()

			expect(result.manifest['/api/data']).toBeDefined()
		})

		it('discovers dynamic route params', async () => {
			mockReaddir.mockImplementation(async (dir: string) => {
				if (dir === 'app') {
					return [
						dirent('+layout.tsx', false),
						dirent('posts', true),
					] as unknown as Dirent[]
				}
				if (dir === 'app/posts') {
					return [dirent('[id]', true)] as unknown as Dirent[]
				}
				if (dir === 'app/posts/[id]') {
					return [dirent('+page.tsx', false)] as unknown as Dirent[]
				}
				return [] as unknown as Dirent[]
			})

			const finder = new Finder(createBuildContext(), {})
			const result = await finder.run()

			const entry = result.manifest['/posts/:id']
			expect(entry).toBeDefined()
			if (!Array.isArray(entry)) {
				expect(entry.__params).toEqual(['id'])
				expect(entry.dynamic).toBe(true)
			}
		})

		it('discovers wildcard routes', async () => {
			mockReaddir.mockImplementation(async (dir: string) => {
				if (dir === 'app') {
					return [
						dirent('+layout.tsx', false),
						dirent('docs', true),
					] as unknown as Dirent[]
				}
				if (dir === 'app/docs') {
					return [dirent('[...slug]', true)] as unknown as Dirent[]
				}
				if (dir === 'app/docs/[...slug]') {
					return [dirent('+page.tsx', false)] as unknown as Dirent[]
				}
				return [] as unknown as Dirent[]
			})

			const finder = new Finder(createBuildContext(), {})
			const result = await finder.run()

			const entry = result.manifest['/docs/*']
			expect(entry).toBeDefined()
			if (!Array.isArray(entry)) {
				expect(entry.wildcard).toBe(true)
			}
		})

		it('discovers middleware files', async () => {
			const exportReader = Object.assign(new ExportReader(), {
				literal: vi.fn().mockResolvedValue(undefined),
				value: vi.fn().mockResolvedValue(undefined),
				has: vi.fn().mockResolvedValue(true),
				exports: vi.fn().mockResolvedValue([]),
			})

			mockReaddir.mockImplementation(async (dir: string) => {
				if (dir === 'app') {
					return [
						dirent('+layout.tsx', false),
						dirent('+middleware.ts', false),
						dirent('+page.tsx', false),
					] as unknown as Dirent[]
				}
				return [] as unknown as Dirent[]
			})

			const finder = new Finder(createBuildContext({ exportReader }), {})
			const result = await finder.run()

			const entry = result.manifest['/']
			expect(entry).toBeDefined()
			if (!Array.isArray(entry)) {
				expect(entry.paths.middlewares?.[0]).toBeTruthy()
			}
		})

		it('discovers loading files', async () => {
			mockReaddir.mockImplementation(async (dir: string) => {
				if (dir === 'app') {
					return [
						dirent('+layout.tsx', false),
						dirent('+loading.tsx', false),
						dirent('+page.tsx', false),
					] as unknown as Dirent[]
				}
				return [] as unknown as Dirent[]
			})

			const finder = new Finder(createBuildContext(), {})
			const result = await finder.run()

			const entry = result.manifest['/']
			expect(entry).toBeDefined()
			if (!Array.isArray(entry)) {
				expect(entry.paths.loaders?.[0]).toBeTruthy()
			}
		})
	})

	describe('process', () => {
		it('handles empty scan result', async () => {
			const finder = new Finder(createBuildContext(), {})
			const result = await finder.process({ segments: [], endpoints: [] })

			expect(result.manifest).toEqual({})
			expect(result.modules).toEqual({})
			expect(result.prerenderRoutes.size).toBe(0)
			expect(result.knownRoutes.size).toBe(0)
		})
	})
})
