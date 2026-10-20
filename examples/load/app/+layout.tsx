export const metadata = {
	title: '%s - Solas load',
}

const navigation = [
	['/', 'home'],
	['/render?rows=2000&work=2000', 'render'],
	['/stream?sections=16&work=5000', 'stream'],
	['/client?rows=2000&work=200', 'client'],
	['/links?count=500', 'links'],
	['/api/work?work=100000', 'api'],
]

export default function Shell({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en">
			<head>
				<meta charSet="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<style
					dangerouslySetInnerHTML={{
						__html: `
							:root { color-scheme: light dark; font-family: ui-monospace, monospace; }
							body { margin: 0; padding: 0 1.5rem 4rem; line-height: 1.5; }
							header { display: flex; flex-wrap: wrap; gap: 1rem; align-items: baseline; padding: 1rem 0; border-bottom: 1px solid currentColor; }
							nav { display: flex; flex-wrap: wrap; gap: 1rem; }
							main { padding-top: 1.5rem; }
							table { border-collapse: collapse; }
							th, td { text-align: left; padding: 0.25rem 0.75rem; border-bottom: 1px solid color-mix(in srgb, currentColor 25%, transparent); }
							code { font-weight: bold; }
						`,
					}}
				/>
			</head>

			<body>
				<header>
					<strong>Solas load</strong>
					<nav>
						{navigation.map(([href, label]) => (
							<a key={href} href={href}>
								{label}
							</a>
						))}
					</nav>
				</header>

				<main>{children}</main>
			</body>
		</html>
	)
}
