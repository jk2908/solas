import { Link } from '@jk2908/solas/router'

export const prerender = 'full'

export default function Page() {
	return (
		<div>
			<h2>Static full page</h2>
			<div>This route is fully prerendered and uses the whole-route cache.</div>
			<Link href="/about/another/live">Back to the dynamic PPR demo</Link>
		</div>
	)
}
