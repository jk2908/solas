import { Link } from '@jk2908/solas/router'

export const metadata = {
	title: 'Home',
}

export default function Page() {
	return (
		<section>
			<h1>Strict CSP</h1>

			<p>
				This example enforces a nonce-based CSP in production. Open the{' '}
				<Link href="/styles">styles</Link> route, then navigate away and back. The
				hoistable style should keep working because Solas reuses the document nonce for
				client navigations.
			</p>
		</section>
	)
}
