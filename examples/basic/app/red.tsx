'use client'

import { useSearchParams } from '@jk2908/solas/navigation'

export function Red() {
	const params = useSearchParams()
	const entries = Object.fromEntries(params.entries())

	return <pre>{JSON.stringify(entries, null, 2)}</pre>
}
