import { Link } from '@jk2908/solas/router'

export const metadata = {
	title: 'About defined in page',
}

export default function Page() {
	return (
		<div>
			<div>I am the about page lolololol</div>
			<Link href="/about/another" prefetch="hover">
				PPR route
			</Link>
		</div>
	)
}
