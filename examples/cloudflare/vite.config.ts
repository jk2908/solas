import { defineConfig } from 'vite'

import solas from '@jk2908/solas'
import { cloudflare } from '@jk2908/solas/cloudflare/vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
	plugins: [
		solas({
			prerender: 'full',
			adapter: cloudflare(),
		}),
		react(),
	],
	resolve: {
		tsconfigPaths: true,
	},
})
