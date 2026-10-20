import { url } from '@jk2908/solas/server'

import { ClientStress } from '../heavy-client.js'
import { clampInt } from '../lib/work.js'

export const metadata = {
	title: 'Client',
}

export default async function Page() {
	const { searchParams } = await url()
	const rows = clampInt(searchParams.get('rows'), 2000, 1, 50000)
	const work = clampInt(searchParams.get('work'), 200, 1, 20000)

	return (
		<section>
			<h1>Client stress</h1>

			<p>
				The list is rendered on the server and re-rendered in the browser. Use the buttons
				to force recomputation and reconciliation.
			</p>

			<ClientStress initialRows={rows} initialWork={work} />
		</section>
	)
}
