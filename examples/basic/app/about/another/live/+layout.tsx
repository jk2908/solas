import { dynamic } from '@jk2908/solas/server'

export const prerender = 'ppr'

export default async function Layout({ children }: { children: React.ReactNode }) {
	await dynamic()

	return (
		<div>
			<div>Dynamic layout rendered at {Date.now()}</div>
			{children}
		</div>
	)
}
