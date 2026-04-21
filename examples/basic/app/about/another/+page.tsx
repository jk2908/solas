import { Suspense } from 'react'

import { dynamic, headers, url } from '@jk2908/solas/server'

import { ClientButton } from '../client-button.js'

export const prerender = 'ppr'

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

			<ClientButton />
		</>
	)
}

async function D1() {
	await dynamic()

	return <div>{Date.now()}</div>
}

function D2() {
	return <div>{Date.now()}</div>
}

async function D3() {
	const h = await headers()
	const u = await url()

	return (
		<div>
			<div>Headers:</div>
			<pre>{JSON.stringify(Object.fromEntries(h.entries()), null, 2)}</pre>
			<div>URL:</div>
			<pre>{JSON.stringify(u, null, 2)}</pre>
		</div>
	)
}
