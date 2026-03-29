import { Link } from '@jk2908/solas/navigation'

export default async function Page() {
	await new Promise(resolve => setTimeout(resolve, 2000))
	const data = await fetch('http://localhost:4173/posts').then(res => res.json())

	return (
		<div>
			{data?.map(d => (
				<div key={d.id}>{d.title}</div>
			))}

			<Link href="/p/post-that-does-not-exist">Go to non-existing post</Link>
		</div>
	)
}
