import { headers } from '@jk2908/solas/server'

export const metadata = {
	title: 'Styles',
}

export default async function Page() {
	const nonce = (await headers()).get('x-nonce')

	return (
		<section>
			<h1>Styles</h1>

			<style href="/example.css" precedence="medium" nonce={nonce}>
				{`.styled { color: crimson; font-weight: 700; }`}
			</style>

			<p className="styled">This text is crimson and bold.</p>
			<p>
				Navigate home and back. The style is inserted again on the client and must still
				match the document CSP.
			</p>
		</section>
	)
}
