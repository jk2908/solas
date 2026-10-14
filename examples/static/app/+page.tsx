import { Link } from '@jk2908/solas/router'

export const metadata = {
	title: 'Home',
}

export default function Page() {
	return (
		<div>
			<h1>Static Site</h1>
			<p>Every route is prerendered to HTML at build time.</p>
			<Link href="/about">About</Link>
		</div>
	)
}
