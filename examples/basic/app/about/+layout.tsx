const STATIC_TIMESTAMP = Date.now()

export default function Layout({ children }: { children: React.ReactNode }) {
	return (
		<div>
			<div>
				<strong>Static about layout</strong> — this layout belongs to the PPR shell.
				<div>Static about timestamp: {STATIC_TIMESTAMP}</div>
			</div>
			{children}
		</div>
	)
}
