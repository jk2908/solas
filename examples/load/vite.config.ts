import { defineConfig } from 'vite'

import solas from '@jk2908/solas'
import react from '@vitejs/plugin-react'

export default defineConfig({
	server: { port: 4321 },
	preview: { port: 4321 },
	plugins: [
		solas({
			url: 'http://127.0.0.1:4321',
			// emit brotli variants so the Node runtime can serve compressed assets
			precompress: true,
			// every request should pay the full render cost; nothing here is prerendered
			prerender: false,
			metadata: {
				title: '%s - Solas load',
			},
		}),
		react(),
	],
})
