import { Suspense } from 'react'

import { Link } from '@jk2908/solas/router'

export default function Page() {
	return (
		<div>
			<Link href="/navigation">Go back?</Link>

			<Suspense fallback={<div>Loading...</div>}>
				<LongComponent />
			</Suspense>
		</div>
	)
}

export async function LongComponent() {
	await new Promise(r => setTimeout(r, 3000))
	return <div>Long component loaded</div>
}
