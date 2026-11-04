export default function Page() {
	return (
		<article>
			<h1>Dashboard</h1>
			<p>
				This page is <code>app/(app)/dashboard/+page.tsx</code> and renders at{' '}
				<code>/dashboard</code>.
			</p>
			<p>
				The <code>(app)</code> middleware adds an <code>x-route-group: app</code> response
				header. Check it with <code>curl -i</code>.
			</p>
		</article>
	)
}
