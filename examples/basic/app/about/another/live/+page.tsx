import { Suspense } from 'react'

import { Link } from '@jk2908/solas/router'
import { dynamic } from '@jk2908/solas/server'

export const prerender = 'ppr'

export default function Page() {
	return (
		<>
			<section>
				<h2>Static live page shell</h2>
				<div>
					This text is in the page shell. It should be visible before the dynamic page
					data arrives.
				</div>
			</section>

			<section>
				<h2>Dynamic live page section</h2>
				<Suspense fallback={<div>Loading dynamic page data...</div>}>
					<DynamicPageData />
				</Suspense>
			</section>

			<nav>
				<Link href="/about/another/live/next" prefetch="hover">
					Go to the next live page
				</Link>
				<Link href="/about/another/static">Open the static page</Link>
			</nav>
		</>
	)
}

async function DynamicPageData() {
	await dynamic()
	await new Promise(resolve => setTimeout(resolve, 1500))

	return <div>Dynamic page data rendered at {Date.now()}</div>
}
