import { Suspense } from 'react'

import { dynamic, headers } from '@jk2908/solas/server'

export const metadata = {
	title: 'PPR CSP',
}

export const prerender = 'ppr'

export default function Page() {
	return (
		<main>
			<style>{`main { background-color: rgb(4, 5, 6); }`}</style>
			<h1>PPR CSP</h1>

			<Suspense fallback={<p>Loading...</p>}>
				<Streamed />
			</Suspense>
		</main>
	)
}

async function Streamed() {
	const nonce = (await headers()).get('x-nonce')

	await dynamic()

	return (
		<>
			<style nonce={nonce}>{`main p { background-color: red; }`}</style>
			<script nonce={nonce}>{`document.documentElement.dataset.pprCsp = 'ok'`}</script>
			<p>Rendered at {Date.now()}</p>
		</>
	)
}
