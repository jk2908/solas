import { defineConfig } from 'vite'

import solas from '@jk2908/solas'
import react from '@vitejs/plugin-react'

export default defineConfig({
	server: { port: 4323 },
	preview: { port: 4323 },
	plugins: [
		solas({
			url: 'http://127.0.0.1:4323',
			precompress: true,
			csp: {
				directives: {
					'default-src': ['self'],
					'script-src': ['self', 'strict-dynamic'],
					'style-src': ['self'],
					'img-src': ['self', 'data:'],
					'object-src': ['none'],
					'base-uri': ['self'],
				},
			},
		}),
		react(),
	],
})
