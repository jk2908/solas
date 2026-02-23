import { Suspense } from 'react'

import { dynamic } from '@jk2908/drift/server'

export default function Page() {
	return (
		<>
			<div>Some page data</div>

			<Suspense fallback={<div>Loading...</div>}>
				<D1 />
			</Suspense>

			<D2 />
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
