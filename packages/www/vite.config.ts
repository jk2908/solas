import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vite'

import drift from '@jk2908/drift'
import tsconfigPaths from 'vite-tsconfig-paths'

const resolver = (p: string) => resolve(dirname(fileURLToPath(import.meta.url)), p)

export default defineConfig(() => {
	return {
		plugins: [
			drift({
				url: 'http://localhost:8787',
				prerender: false,
				metadata: {
					title: '%s - drift',
				},
			}),
			tsconfigPaths(),
		],
		resolve: {
			alias: {
				'#': resolver('./'),
			},
		},
	}
})
