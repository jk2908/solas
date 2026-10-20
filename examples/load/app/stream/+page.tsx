import { Suspense } from 'react'

import { url } from '@jk2908/solas/server'

import { burn, clampInt } from '../lib/work.js'

export const metadata = {
	title: 'Stream',
}

export default async function Page() {
	const { searchParams } = await url()
	const sections = clampInt(searchParams.get('sections'), 16, 1, 200)
	const work = clampInt(searchParams.get('work'), 5000, 1, 200000)
	const delay = clampInt(searchParams.get('delay'), 0, 0, 5000)

	return (
		<section>
			<h1>Stream stress</h1>

			<p>
				sections={sections} work={work} delay={delay}ms
			</p>

			{Array.from({ length: sections }, (_, index) => (
				<Suspense key={index} fallback={<p>loading section {index}…</p>}>
					<Section index={index} work={work} delay={delay} />
				</Suspense>
			))}
		</section>
	)
}

async function Section({
	index,
	work,
	delay,
}: {
	index: number
	work: number
	delay: number
}) {
	if (delay > 0) {
		await new Promise(resolve => setTimeout(resolve, delay))
	}

	const value = burn(index + 1, work)

	return (
		<p>
			section {index}: {value.toString(36)}
		</p>
	)
}
