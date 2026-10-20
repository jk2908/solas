import { defineConfig } from 'vite'

import solas from '@jk2908/solas'
import cxx from '@jk2908/cxx/vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
	server: { port: 4322 },
	preview: { port: 4322 },
	plugins: [
		solas({
			url: 'http://127.0.0.1:4322',
			precompress: true,
			metadata: {
				title: '%s - Solas CSP',
			},
		}),
		react(),
		cxx(),
	],
})
