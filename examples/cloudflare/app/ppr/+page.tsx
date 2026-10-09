import { Suspense } from 'react'

import { dynamic } from '@jk2908/solas/server'

export const prerender = 'ppr'

export const metadata = {
	title: 'PPR',
}

export default function Page() {
	return (
		<>
			<h1>Partial prerender</h1>
			<p>This shell is prerendered. The value below is streamed at request time.</p>

			<Suspense fallback={<p>Loading…</p>}>
				<Dynamic />
			</Suspense>
		</>
	)
}

async function Dynamic() {
	await dynamic()

	return <p>Generated at {new Date().toISOString()}</p>
}
