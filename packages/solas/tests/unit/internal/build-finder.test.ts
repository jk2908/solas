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

function mockTree(tree: Record<string, string[]>) {
	mockReaddir.mockImplementation(async (dir: string) => {
		return (tree[dir] ?? []).map(entry => {
			const isDir = entry.endsWith('/')
			return dirent(isDir ? entry.slice(0, -1) : entry, isDir)
		}) as unknown as Dirent[]
	})
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

		it('discovers grouped pages and endpoints at stripped routes', async () => {
			const exportReader = Object.assign(new ExportReader(), {
				literal: vi.fn().mockResolvedValue(undefined),
				value: vi.fn().mockResolvedValue(undefined),
				has: vi.fn().mockResolvedValue(false),
				exports: vi.fn().mockResolvedValue(['GET']),
			})

			mockTree({
				app: ['+layout.tsx', '(marketing)/'],
				'app/(marketing)': ['+layout.tsx', 'blog/', 'api/'],
				'app/(marketing)/blog': ['[slug]/'],
				'app/(marketing)/blog/[slug]': ['+page.tsx'],
				'app/(marketing)/api': ['+endpoint.ts'],
			})

			const finder = new Finder(createBuildContext({ exportReader }), {})
			const result = await finder.run()

			const page = result.manifest['/blog/:slug']
			expect(page).toBeDefined()

			if (page && !Array.isArray(page) && 'paths' in page) {
				expect(page.__params).toEqual(['slug'])
				expect(page.paths.layouts?.some(layout => layout?.includes('(marketing)'))).toBe(
					true,
				)
			}

			expect(result.manifest['/api']).toBeDefined()
			expect(Array.isArray(result.manifest['/'])).toBe(false)
		})

		const conflictCases: {
			name: string
			tree: Record<string, string[]>
			error: RegExp
		}[] = [
			{
				name: 'two pages at the same URL',
				tree: {
					app: ['+layout.tsx', '(a)/', '(b)/'],
					'app/(a)': ['about/'],
					'app/(a)/about': ['+page.tsx'],
					'app/(b)': ['about/'],
					'app/(b)/about': ['+page.tsx'],
				},
				error: /Route conflict: \/about is declared by two pages/,
			},
			{
				name: 'two endpoints for the same method',
				tree: {
					app: ['+layout.tsx', '(a)/', '(b)/'],
					'app/(a)': ['users/'],
					'app/(a)/users': ['+endpoint.ts'],
					'app/(b)': ['users/'],
					'app/(b)/users': ['+endpoint.ts'],
				},
				error: /Route conflict: GET \/users is declared by two endpoints/,
			},
			{
				name: 'two routes with the same shape',
				tree: {
					app: ['+layout.tsx', '(a)/', '(b)/'],
					'app/(a)': ['blog/'],
					'app/(a)/blog': ['[id]/'],
					'app/(a)/blog/[id]': ['+page.tsx'],
					'app/(b)': ['blog/'],
					'app/(b)/blog': ['[slug]/'],
					'app/(b)/blog/[slug]': ['+page.tsx'],
				},
				error: /match the same URLs/,
			},
			{
				name: 'an invalid group name',
				tree: {
					app: ['+layout.tsx', '(bad name)/'],
					'app/(bad name)': ['about/'],
					'app/(bad name)/about': ['+page.tsx'],
				},
				error: /Invalid route group "\(bad name\)"/,
			},
		]

		it.each(conflictCases)('fails on $name', async ({ tree, error }) => {
			const exportReader = Object.assign(new ExportReader(), {
				literal: vi.fn().mockResolvedValue(undefined),
				value: vi.fn().mockResolvedValue(undefined),
				has: vi.fn().mockResolvedValue(false),
				exports: vi.fn().mockResolvedValue(['GET']),
			})

			mockTree(tree)

			const finder = new Finder(createBuildContext({ exportReader }), {})
			await expect(finder.run()).rejects.toThrow(error)
		})

		it.each(['+endpoint.mts', '+endpoint.mjs'])(
			'discovers %s endpoint files',
			async file => {
				const exportReader = Object.assign(new ExportReader(), {
					literal: vi.fn().mockResolvedValue(undefined),
					value: vi.fn().mockResolvedValue(undefined),
					has: vi.fn().mockResolvedValue(false),
					exports: vi.fn().mockResolvedValue(['GET']),
				})

				mockReaddir.mockImplementation(async (dir: string) => {
					if (dir === 'app') {
						return [
							dirent('+layout.tsx', false),
							dirent('api', true),
						] as unknown as Dirent[]
					}
					if (dir === 'app/api') {
						return [dirent(file, false)] as unknown as Dirent[]
					}
					return [] as unknown as Dirent[]
				})

				const finder = new Finder(createBuildContext({ exportReader }), {})
				const result = await finder.run()

				expect(result.manifest['/api']).toBeDefined()
			},
		)

		it('ignores CommonJS endpoint files', async () => {
			const exportReader = Object.assign(new ExportReader(), {
				literal: vi.fn().mockResolvedValue(undefined),
				value: vi.fn().mockResolvedValue(undefined),
				has: vi.fn().mockResolvedValue(false),
				exports: vi.fn().mockResolvedValue(['GET']),
			})

			mockReaddir.mockImplementation(async (dir: string) => {
				if (dir === 'app') {
					return [
						dirent('+layout.tsx', false),
						dirent('+page.tsx', false),
						dirent('api', true),
					] as unknown as Dirent[]
				}
				if (dir === 'app/api') {
					return [dirent('+endpoint.cjs', false)] as unknown as Dirent[]
				}
				return [] as unknown as Dirent[]
			})

			const finder = new Finder(createBuildContext({ exportReader }), {})
			const result = await finder.run()

			expect(result.manifest['/api']).toBeUndefined()
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

		it.each(['+middleware.mts', '+middleware.mjs'])(
			'discovers %s middleware files',
			async file => {
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
							dirent(file, false),
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
			},
		)

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
