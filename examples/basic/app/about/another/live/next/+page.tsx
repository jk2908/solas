import { Suspense } from 'react'

import { Link } from '@jk2908/solas/router'
import { dynamic } from '@jk2908/solas/server'

export const prerender = 'ppr'

export default function Page() {
	return (
		<div>
			<div>Next static PPR page content</div>

			<Suspense fallback={<div>Loading the next dynamic page...</div>}>
				<DynamicPageData />
			</Suspense>

			<Link href="/about/another/live" prefetch="hover">
				Back to the live page
			</Link>
		</div>
	)
}

async function DynamicPageData() {
	await dynamic()
	await new Promise(resolve => setTimeout(resolve, 1500))

	return <div>Next dynamic page data rendered at {Date.now()}</div>
}
