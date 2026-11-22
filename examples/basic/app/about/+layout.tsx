export default function Layout({ children }: { children: React.ReactNode }) {
	return (
		<div>
			<div>
				<strong>Static about layout</strong> — this layout belongs to the PPR shell.
			</div>
			{children}
		</div>
	)
}
