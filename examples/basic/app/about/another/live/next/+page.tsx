import { Suspense } from 'react'

import { Link } from '@jk2908/solas/router'
import { dynamic } from '@jk2908/solas/server'

export const prerender = 'ppr'

export default function Page() {
	return (
		<>
			<section>
				<h2>Next static live page shell</h2>
				<div>This is a different page under the same dynamic live layout.</div>
			</section>

			<section>
				<h2>Next dynamic live page section</h2>
				<Suspense fallback={<div>Loading the next dynamic page...</div>}>
					<DynamicPageData />
				</Suspense>
			</section>

			<nav>
				<Link href="/about/another/live" prefetch="hover">
					Back to the live page
				</Link>
			</nav>
		</>
	)
}

async function DynamicPageData() {
	await dynamic()
	await new Promise(resolve => setTimeout(resolve, 1500))

	return <div>Next dynamic page data rendered at {Date.now()}</div>
}
