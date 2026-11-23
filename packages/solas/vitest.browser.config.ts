import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

export default defineConfig({
	plugins: [react()],
	resolve: {
		alias: {
			'node:async_hooks': fileURLToPath(
				new URL('./tests/mocks/async-hooks.ts', import.meta.url),
			),
		},
	},
	optimizeDeps: {
		exclude: ['@vitejs/plugin-rsc'],
	},
	test: {
		browser: {
			enabled: true,
			provider: playwright({ headless: true }),
			instances: [{ browser: 'chromium' }],
		},
		include: ['tests/unit/**/*.test.tsx'],
		setupFiles: ['./vitest.browser.setup.ts'],
	},
})
