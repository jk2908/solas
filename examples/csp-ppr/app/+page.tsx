import { Suspense } from 'react'

import { dynamic } from '@jk2908/solas/server'

export const prerender = 'ppr'

export default function Page() {
	return (
		<main>
			<h1>PPR CSP</h1>
			<Suspense fallback={<p>Loading...</p>}>
				<Streamed />
			</Suspense>
		</main>
	)
}

async function Streamed() {
	await dynamic()

	return <p>Rendered at {Date.now()}</p>
}
