import { headers } from '@jk2908/solas/server'

export const prerender = false

export default async function Page() {
	const nonce = (await headers()).get('x-nonce')

	return (
		<main>
			<style nonce={nonce}>{`main { color: rgb(1, 2, 3); }`}</style>
			<script nonce={nonce}>
				{`document.documentElement.dataset.dynamicCsp = 'ok'`}
			</script>
			<h1>Dynamic CSP</h1>
			<p>This document uses a per-request nonce.</p>
		</main>
	)
}
