export const metadata = {
	title: 'Solas Static Example',
}

export default function Shell({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en">
			<head>
				<meta charSet="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
			</head>

			<body>
				<header>Solas Static Example</header>
				<main>{children}</main>
				<footer>Built with the static adapter</footer>
			</body>
		</html>
	)
}
