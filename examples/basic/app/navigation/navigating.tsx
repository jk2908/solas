'use client'

import { useRouter } from '@jk2908/solas/router'

export function Navigating() {
	const { isNavigating } = useRouter()

	return (
		<div>
			<h1>Is navigating: {isNavigating ? 'Yes' : 'No'}</h1>
		</div>
	)
}
