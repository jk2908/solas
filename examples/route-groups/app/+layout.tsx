export const metadata = {
	title: 'Solas route groups',
}

const navigation = [
	['/', 'home'],
	['/about', 'about'],
	['/pricing', 'pricing'],
	['/blog/hello', 'blog'],
	['/dashboard', 'dashboard'],
	['/settings', 'settings'],
	['/api/health', 'api'],
] as const

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
							.group { border: 1px dashed color-mix(in srgb, currentColor 40%, transparent); border-radius: 0.5rem; padding: 1rem; margin: 1rem 0; }
							.group-label { margin: 0 0 0.75rem; font-size: 0.75rem; letter-spacing: 0.08em; text-transform: uppercase; opacity: 0.7; }
							code { font-weight: bold; }
							a { color: inherit; }
						`,
					}}
				/>
			</head>

			<body>
				<header>
					<strong>Solas route groups</strong>
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
