export const prerender = 'ppr'

export default function Layout({ children }: { children: React.ReactNode }) {
	return (
		<div>
			<div>
				<strong>Static another layout</strong> — this stays mounted while the live subtree
				changes.
			</div>
			{children}
		</div>
	)
}
