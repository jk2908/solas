import { defineConfig } from 'vite'

import solas from '@jk2908/solas'
import react from '@vitejs/plugin-react'

export default defineConfig(() => {
	return {
		plugins: [
			solas({
				prerender: 'full',
				sitemap: {
					async routes(existing) {
						return [...existing, '/extra-sitemap-route']
					},
				},
				metadata: {
					title: '%s - jk2908',
					meta: [
						{
							name: 'random',
							content: 'This is a random meta tag for testing purposes',
						},
					],
				},
			}),
			react(),
		],
		resolve: {
			tsconfigPaths: true,
		},
	}
})
