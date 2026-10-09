import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { Plugin, ResolvedConfig, UserConfig } from 'vite'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import solas from '../../src/index.js'

const GENERATED_FILES = [
	'config.ts',
	'manifest.ts',
	'maps.ts',
	'entry.rsc.tsx',
	'entry.ssr.tsx',
	'entry.browser.tsx',
	'solas.d.ts',
]

let dir: string
let previousCwd: string

function write(relative: string, content: string) {
	writeFileSync(path.join(dir, relative), content)
}

function getPlugin(config?: Record<string, unknown>) {
	const [plugin] = solas({ ...config })
	return plugin as Plugin
}

beforeEach(() => {
	dir = mkdtempSync(path.join(tmpdir(), 'solas-plugin-'))
	mkdirSync(path.join(dir, 'app'))
	write(
		'app/+layout.tsx',
		'export default function Layout() { return <div>{children}</div> }',
	)
	write('app/+page.tsx', 'export default function Home() { return <h1>Home</h1> }')
	previousCwd = process.cwd()
	process.chdir(dir)
})

afterEach(() => {
	vi.unstubAllEnvs()
	process.chdir(previousCwd)
	rmSync(dir, { recursive: true, force: true })
})

async function runConfig(plugin: Plugin, viteConfig: UserConfig) {
	const hook = plugin.config as (config: UserConfig) => void | Promise<void> | undefined
	await hook?.(viteConfig)
}

function resolveServe(plugin: Plugin) {
	const hook = plugin.configResolved as
		| ((config: ResolvedConfig) => void | Promise<void>)
		| undefined
	hook?.({
		command: 'serve',
		configFile: false,
		root: dir,
		mode: 'development',
		base: '/',
		publicDir: path.join(dir, 'public'),
		server: {},
	} as unknown as ResolvedConfig)
}

async function generate(plugin: Plugin, viteConfig: UserConfig = {}) {
	await runConfig(plugin, viteConfig)
	resolveServe(plugin)

	const hook = plugin.buildStart as (() => void | Promise<void>) | undefined
	await hook?.()
}

describe('solas() plugin integration', () => {
	it('derives url and port from the vite server config', async () => {
		const plugin = getPlugin()
		const viteConfig: UserConfig = { server: {} }

		await runConfig(plugin, viteConfig)

		expect(viteConfig.server?.port).toBe(8787)
		expect(viteConfig.define?.['import.meta.env.VITE_APP_URL']).toBe(
			JSON.stringify('http://localhost:8787'),
		)
	})

	it('uses the vite server port and host for the derived url', async () => {
		const plugin = getPlugin()
		const viteConfig: UserConfig = { server: { host: '127.0.0.1', port: 4000 } }

		await runConfig(plugin, viteConfig)

		expect(viteConfig.server?.port).toBe(4000)
		expect(viteConfig.define?.['import.meta.env.VITE_APP_URL']).toBe(
			JSON.stringify('http://127.0.0.1:4000'),
		)
	})

	it('respects VITE_APP_URL', async () => {
		vi.stubEnv('VITE_APP_URL', 'https://example.com')
		const plugin = getPlugin()
		const viteConfig: UserConfig = { server: { port: 3000 } }

		await runConfig(plugin, viteConfig)

		expect(viteConfig.define?.['import.meta.env.VITE_APP_URL']).toBe(
			JSON.stringify('https://example.com'),
		)
	})

	it('prefers the url option over VITE_APP_URL', async () => {
		vi.stubEnv('VITE_APP_URL', 'https://env.example.com')
		const plugin = getPlugin({ url: 'https://option.example.com' })
		const viteConfig: UserConfig = { server: { port: 3000 } }

		await runConfig(plugin, viteConfig)

		expect(viteConfig.define?.['import.meta.env.VITE_APP_URL']).toBe(
			JSON.stringify('https://option.example.com'),
		)
	})

	it('writes generated route artifacts for a basic app', async () => {
		const plugin = getPlugin()

		await generate(plugin)

		for (const file of GENERATED_FILES) {
			expect(existsSync(path.join(dir, '.solas', file)), `missing .solas/${file}`).toBe(
				true,
			)
		}
	})

	it('generates a valid, formatted rsc entry', async () => {
		const plugin = getPlugin()

		await generate(plugin)

		const entry = readFileSync(path.join(dir, '.solas', 'entry.rsc.tsx'), 'utf-8')
		expect(entry).toContain("from '@jk2908/solas/env/rsc'")
		expect(entry).toContain('createRuntimeHandler')
		expect(entry).toContain(
			'export default await createRuntimeHandler(config, manifest, importMap)',
		)
		expect(entry).not.toContain('Solas.Config')
		expect(entry).not.toContain('  ')
	})
})
