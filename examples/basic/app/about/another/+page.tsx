import { Suspense } from 'react'

import { dynamic, headers, url } from '@jk2908/drift/server'

export default function Page() {
	return (
		<>
			<div>Some page data</div>

			<Suspense fallback={<div>Loading...</div>}>
				<D1 />
			</Suspense>

			<D2 />

			<Suspense fallback={<div>Loading...</div>}>
				<D3 />
			</Suspense>
		</>
	)
}

async function D1() {
	dynamic()

	return <div>{Date.now()}</div>
}

function D2() {
	return <div>{Date.now()}</div>
}

function D3() {
	const h = headers()
	const u = url()

	return (
		<div>
			<div>Headers:</div>
			<pre>{JSON.stringify(Object.fromEntries(h.entries()), null, 2)}</pre>
			<div>URL:</div>
			<pre>{JSON.stringify(u, null, 2)}</pre>
		</div>
	)
}
