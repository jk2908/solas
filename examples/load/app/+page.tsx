import { Link } from '@jk2908/solas/router'

export const metadata = {
	title: 'Home',
}

const routes = [
	{
		href: '/render?rows=2000&work=2000',
		name: '/render',
		what: 'server render: rows value objects, each doing work iterations',
	},
	{
		href: '/stream?sections=16&work=5000&delay=0',
		name: '/stream',
		what: 'streaming: independent Suspense sections resolving at the same time',
	},
	{
		href: '/client?rows=2000&work=200',
		name: '/client',
		what: 'client re-render: button forces the whole list to recompute',
	},
	{
		href: '/links?count=500',
		name: '/links',
		what: 'client navigation: many Link components in one payload',
	},
	{
		href: '/api/work?work=100000',
		name: '/api/work',
		what: 'endpoint only: CPU work with no RSC or SSR',
	},
]

export default function Page() {
	return (
		<section>
			<h1>Load harness</h1>

			<p>
				Every route is parameterised so one deployment can cover cheap and expensive
				cases. Defaults are deliberately moderate; scale them up until throughput
				saturates.
			</p>

			<ul>
				{routes.map(route => (
					<li key={route.name}>
						<Link href={route.href}>{route.name}</Link> — {route.what}
					</li>
				))}
			</ul>

			<h2>Parameters</h2>

			<table>
				<thead>
					<tr>
						<th>route</th>
						<th>parameter</th>
						<th>default</th>
						<th>range</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td>
							<code>/render</code>
						</td>
						<td>
							<code>rows</code>
						</td>
						<td>2000</td>
						<td>1–50000</td>
					</tr>
					<tr>
						<td>
							<code>/render</code>
						</td>
						<td>
							<code>work</code>
						</td>
						<td>2000</td>
						<td>1–200000</td>
					</tr>
					<tr>
						<td>
							<code>/stream</code>
						</td>
						<td>
							<code>sections</code>
						</td>
						<td>16</td>
						<td>1–200</td>
					</tr>
					<tr>
						<td>
							<code>/stream</code>
						</td>
						<td>
							<code>work</code>
						</td>
						<td>5000</td>
						<td>1–200000</td>
					</tr>
					<tr>
						<td>
							<code>/stream</code>
						</td>
						<td>
							<code>delay</code>
						</td>
						<td>0</td>
						<td>0–5000ms</td>
					</tr>
					<tr>
						<td>
							<code>/client</code>
						</td>
						<td>
							<code>rows</code>
						</td>
						<td>2000</td>
						<td>1–50000</td>
					</tr>
					<tr>
						<td>
							<code>/client</code>
						</td>
						<td>
							<code>work</code>
						</td>
						<td>200</td>
						<td>1–20000</td>
					</tr>
					<tr>
						<td>
							<code>/links</code>
						</td>
						<td>
							<code>count</code>
						</td>
						<td>500</td>
						<td>1–5000</td>
					</tr>
					<tr>
						<td>
							<code>/api/work</code>
						</td>
						<td>
							<code>work</code>
						</td>
						<td>100000</td>
						<td>1–2000000</td>
					</tr>
				</tbody>
			</table>
		</section>
	)
}
