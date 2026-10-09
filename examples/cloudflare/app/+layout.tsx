import { Link } from '@jk2908/solas/router'

export const metadata = {
	title: 'Solas on Cloudflare',
}

export default function Layout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en">
			<head>
				<meta charSet="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
			</head>

			<body>
				<header>
					<strong>Solas on Cloudflare</strong> <Link href="/">Home</Link> ·{' '}
					<Link href="/ppr">PPR</Link> · <Link href="/ssr">SSR</Link>
				</header>

				<main>{children}</main>
			</body>
		</html>
	)
}
