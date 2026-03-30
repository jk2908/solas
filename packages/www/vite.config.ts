import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vite'

import solas from '@jk2908/solas'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'

const resolver = (p: string) => resolve(dirname(fileURLToPath(import.meta.url)), p)

export default defineConfig(() => {
	return {
		plugins: [
			solas({
				url: 'http://localhost:8787',
				prerender: false,
				metadata: {
					title: '%s - Solas',
				},
			}),
			react(),
			tsconfigPaths(),
		],
		resolve: {
			alias: {
				'#': resolver('./'),
			},
		},
	}
})
