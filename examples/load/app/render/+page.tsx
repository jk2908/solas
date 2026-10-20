import { url } from '@jk2908/solas/server'

import { burn, clampInt } from '../lib/work.js'

export const metadata = {
	title: 'Render',
}

export default async function Page() {
	const { searchParams } = await url()
	const rows = clampInt(searchParams.get('rows'), 2000, 1, 50000)
	const work = clampInt(searchParams.get('work'), 2000, 1, 200000)

	const started = performance.now()
	const items = Array.from({ length: rows }, (_, index) => {
		const value = burn(index + 1, work)
		return `${index}:${value.toString(36)}`
	})
	const computeMs = performance.now() - started

	return (
		<section>
			<h1>Render stress</h1>

			<p data-rows={rows} data-work={work} data-compute-ms={computeMs.toFixed(1)}>
				rows={rows} work={work} compute={computeMs.toFixed(1)}ms
			</p>

			<ol>
				{items.map(item => (
					<li key={item}>{item}</li>
				))}
			</ol>
		</section>
	)
}
