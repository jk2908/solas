import { Link } from '@jk2908/solas/router'

export const metadata = {
	title: 'About',
}

export default function Page() {
	return (
		<div>
			<h1>About</h1>
			<Link href="/">Home</Link>
		</div>
	)
}
