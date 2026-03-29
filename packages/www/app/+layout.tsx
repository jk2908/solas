import type { Route } from '@jk2908/solas'

import './styles.css'

export const metadata = {
	title: 'Home',
} satisfies Route.Metadata

export const prerender = 'full' satisfies Route.Prerender

export default function Layout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en">
			<body>{children}</body>
		</html>
	)
}
