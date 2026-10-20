import { serve } from '@jk2908/solas/runtime/node'

await serve({
	onListen({ port, host }) {
		const displayHost = host === '0.0.0.0' ? '127.0.0.1' : host

		console.log(`Solas load listening on http://${displayHost}:${port}`)
	},
})
