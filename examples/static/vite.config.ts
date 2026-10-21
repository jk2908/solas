import { defineConfig } from 'vite'

import solas from '@jk2908/solas'
import staticAdapter from '@jk2908/solas/adapters/static'
import react from '@vitejs/plugin-react'

export default defineConfig({
	plugins: [
		// the static adapter sets `prerender: 'full'` on its own
		solas({
			adapter: staticAdapter(),
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
	resolve: {
		tsconfigPaths: true,
	},
})
