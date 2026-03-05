import './styles.css'

export const metadata = {
	title: 'Home',
}

export const prerender = 'full'

export default function Layout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en">
			<body>yoyoyo{children}</body>
		</html>
	)
}
