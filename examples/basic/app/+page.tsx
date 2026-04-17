import { Link } from '@jk2908/solas/router'

import { ServerCounterForm } from './action/form'
import { Blue } from './blue'
import { Red } from './red'

// export const prerender = true

export const metadata = {
	title: 'Home',
}

export default async function Page() {
	return (
		<div>
			Hi am a page <Blue />
			<Link href="/profile">Go to Profile</Link>
			<Link href="/?foo=bar&baz=qux">Go to Home with Search Params</Link>
			<Link href="to-dead-end">Go to Dead End (404)</Link>
			<Link href="/posts/to-dead-end-with-nested-error">
				Go to Dead End with Nested Error (404)
			</Link>
			<Link href="/p/post-2">hi</Link>
			<Link href="/p/:id" params={{ id: 'post-2' }}>
				hi with params
			</Link>
			<Link href="/p/post-2" params={{ id: 'post-2' }}>
				hi with params
			</Link>
			<Link href="/test/thing/other">Go to Test Catch-All</Link>
			<Link href="/about">Go to About</Link>
			<Link href="/about?redirect=true" query={{ redirect: true }}>
				Go to about
			</Link>
			<Red />
			<ServerCounterForm />
		</div>
	)
}
