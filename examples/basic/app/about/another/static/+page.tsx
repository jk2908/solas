import { Link } from '@jk2908/solas/router'

export const prerender = 'full'

const STATIC_PAGE_TIMESTAMP = Date.now()

export default function Page() {
	return (
		<div>
			<h2>Static full page</h2>
			<div>This route is fully prerendered and uses the whole-route cache.</div>
			<div>Static full page timestamp: {STATIC_PAGE_TIMESTAMP}</div>
			<Link href="/about/another/live">Back to the dynamic PPR demo</Link>
		</div>
	)
}
