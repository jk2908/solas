import react from '@vitejs/plugin-react'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

export default defineConfig({
	plugins: [react()],
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
