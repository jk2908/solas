import { Link } from '@jk2908/solas/router'

export default function Page() {
	return (
		<main>
			<style>{`main { color: rgb(10, 11, 12); }`}</style>
			<script>{`document.documentElement.dataset.staticCsp = 'ok'`}</script>
			<h1>Static CSP</h1>
			<p>This document is fully prerendered.</p>
			<Link href="/about">About</Link>
		</main>
	)
}
