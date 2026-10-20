import { Link } from '@jk2908/solas/router'
import { url } from '@jk2908/solas/server'

import { clampInt } from '../lib/work.js'

export const metadata = {
	title: 'Links',
}

export default async function Page() {
	const { searchParams } = await url()
	const count = clampInt(searchParams.get('count'), 500, 1, 5000)

	return (
		<section>
			<h1>Links stress</h1>

			<p>count={count}</p>

			<ul>
				{Array.from({ length: count }, (_, index) => (
					<li key={index}>
						<Link href={`/render?rows=5&work=5&link=${index}`}>render {index}</Link>
					</li>
				))}
			</ul>
		</section>
	)
}
