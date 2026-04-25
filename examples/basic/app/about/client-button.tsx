'use client'

import { useState } from 'react'

export function ClientButton() {
	const [count, setCount] = useState(0)

	return (
		<button type="button" onClick={() => setCount(count + 1)}>
			Client Button: {count}
		</button>
	)
}
