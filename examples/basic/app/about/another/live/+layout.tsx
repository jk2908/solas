import { dynamic } from '@jk2908/solas/server'

export const prerender = 'ppr'

export default async function Layout({ children }: { children: React.ReactNode }) {
	await dynamic()

	return (
		<div>
			<div>
				<strong>Dynamic layout</strong> — rendered for this request. The static about
				layouts above are reused.
			</div>
			<div>Dynamic layout timestamp: {Date.now()}</div>
			{children}
		</div>
	)
}
