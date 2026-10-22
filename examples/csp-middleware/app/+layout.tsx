import { Link } from '@jk2908/solas/router'
import { headers } from '@jk2908/solas/server'

export const metadata = {
	title: '%s - Solas CSP',
}

export default async function Shell({ children }: { children: React.ReactNode }) {
	const nonce = (await headers()).get('x-nonce')

	return (
		<html lang="en">
			<head>
				<meta charSet="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />

				<style nonce={nonce}>{`
					:root { color-scheme: light dark; font-family: ui-monospace, monospace; }
					body { margin: 0; padding: 2rem; line-height: 1.5; }
					nav { display: flex; gap: 1rem; margin-bottom: 2rem; }
				`}</style>
			</head>

			<body>
				<header>
					<nav>
						<Link href="/">home</Link>
						<Link href="/styles">styles</Link>
						<Link href="/cxx">cxx</Link>
					</nav>
				</header>

				<main>{children}</main>
			</body>
		</html>
	)
}
