import { Suspense } from 'react'

import { Link } from '@jk2908/solas/router'
import { dynamic, headers, url } from '@jk2908/solas/server'

import { ClientButton } from '../client-button.js'

export const prerender = 'ppr'

export default function Page() {
	return (
		<>
			<section>
				<h2>Static PPR page</h2>
				<div>Some page data — this is part of the prerendered page shell.</div>
			</section>

			<section>
				<h2>Dynamic page sections</h2>
				<Suspense fallback={<div>Loading dynamic section A...</div>}>
					<D1 />
				</Suspense>
				<D2 />
				<Suspense fallback={<div>Loading dynamic section B...</div>}>
					<D3 />
				</Suspense>
			</section>

			<ClientButton />

			<nav>
				<Link href="/about/another/live" prefetch="hover">
					Open the live dynamic PPR demo
				</Link>
			</nav>
		</>
	)
}

async function demoDelay() {
	await new Promise(resolve => setTimeout(resolve, 1500))
}

async function D1() {
	await dynamic()
	await demoDelay()

	return <div>Dynamic A rendered at {Date.now()}</div>
}

function D2() {
	return <div>Server value rendered at {Date.now()}</div>
}

async function D3() {
	await demoDelay()
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
