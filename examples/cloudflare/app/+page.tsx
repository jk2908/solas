export const metadata = {
	title: 'Home',
}

export default function Page() {
	return (
		<>
			<h1>Full prerender</h1>
			<p>
				This route is rendered at build time and served straight from the Cloudflare
				assets binding.
			</p>
		</>
	)
}
