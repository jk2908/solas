import { defineConfig } from 'vite'

import solas from '@jk2908/solas'
import react from '@vitejs/plugin-react'

export default defineConfig(() => {
	return {
		plugins: [
			solas({
				prerender: false,
				metadata: {
					title: '%s - Solas',
				},
			}),
			react(),
		],
		resolve: {
			tsconfigPaths: true,
		},
	}
})
