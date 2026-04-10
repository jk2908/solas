import { Navigating } from './navigating'

export default function Layout({ children }: { children: React.ReactNode }) {
	return (
		<div>
			<h1>Layout</h1>
			<Navigating />
			{children}
		</div>
	)
}
