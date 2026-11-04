export default function AppLayout({ children }: { children: React.ReactNode }) {
	return (
		<section className="group">
			<p className="group-label">(app) layout</p>
			{children}
		</section>
	)
}
