import { defineConfig } from 'vite'

import solas from '@jk2908/solas'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
	return {
		server: { port: 4324 },
		preview: { port: 4324 },
		plugins: [
			solas({
				url: 'http://127.0.0.1:4324',
				precompress: true,
				...(mode === 'production'
					? {
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
						}
					: {}),
			}),
			react(),
		],
	}
})
