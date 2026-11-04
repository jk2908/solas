import { defineConfig } from 'vite'

import solas from '@jk2908/solas'
import react from '@vitejs/plugin-react'

export default defineConfig({
	server: { port: 4330 },
	preview: { port: 4330 },
	plugins: [
		solas({
			url: 'http://127.0.0.1:4330',
			metadata: {
				title: '%s - Solas route groups',
			},
		}),
		react(),
	],
})
