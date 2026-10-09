export const prerender = false

export const metadata = {
	title: 'SSR',
}

export default function Page() {
	const nonce = Math.random().toString(36).slice(2, 10)

	return (
		<>
			<h1>Server rendered</h1>
			<p>This route is rendered fresh on every request.</p>
			<p>Request nonce: {nonce}</p>
		</>
	)
}
