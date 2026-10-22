import { defineConfig } from 'vite'

import solas from '@jk2908/solas'
import staticAdapter from '@jk2908/solas/adapters/static'
import react from '@vitejs/plugin-react'

export default defineConfig({
	server: { port: 4325 },
	preview: { port: 4325 },
	plugins: [
		solas({
			adapter: staticAdapter(),
			url: 'http://127.0.0.1:4325',
			csp: {
				directives: {
					'default-src': ['self'],
					'script-src': ['self'],
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
