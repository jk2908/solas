export const prerender = false

export default function Page() {
	return (
		<main>
			<h1>Dynamic CSP</h1>
			<p>This document uses a per-request nonce.</p>
		</main>
	)
}
