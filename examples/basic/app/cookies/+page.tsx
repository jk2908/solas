import { cookies } from '@jk2908/drift/server'

export default async function Page() {
	const c = await cookies()
	const entries = Array.from(c.entries())

	return (
		<div>
			<h1>Cookies</h1>
			<pre>{JSON.stringify({ entries }, null, 2)}</pre>
		</div>
	)
}
