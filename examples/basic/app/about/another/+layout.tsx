export const prerender = 'ppr'

const STATIC_TIMESTAMP = Date.now()

export default function Layout({ children }: { children: React.ReactNode }) {
	return (
		<div>
			<div>
				<strong>Static another layout</strong> — this stays mounted while the live subtree
				changes.
			</div>
			<div>Static another timestamp: {STATIC_TIMESTAMP}</div>
			{children}
		</div>
	)
}
