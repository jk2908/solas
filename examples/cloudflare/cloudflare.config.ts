import { defineConfig, defineWorker } from 'cf/config'

export default defineConfig({
	worker: defineWorker({
		name: 'solas-cloudflare-example',
		compatibilityDate: '2026-10-02',
		compatibilityFlags: ['nodejs_compat'],
	}),
})
