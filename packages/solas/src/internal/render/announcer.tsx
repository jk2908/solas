'use client'

import { useEffect, useState } from 'react'

import * as Events from '../../events.js'
import './announcer.css'

/**
 * Announces the new document title after client-side navigation through a
 * screen-reader only live region.
 */
export function Announcer() {
	const [message, setMessage] = useState('')

	useEffect(() => {
		let frame: number | null = null

		function announce() {
			if (frame != null) cancelAnimationFrame(frame)

			setMessage('')

			frame = requestAnimationFrame(() => {
				setMessage(document.title)
			})
		}

		window.addEventListener(Events.names.NAVIGATION_COMMITTED, announce)

		return () => {
			window.removeEventListener(Events.names.NAVIGATION_COMMITTED, announce)

			if (frame != null) cancelAnimationFrame(frame)
			frame = null
		}
	}, [])

	return (
		<div id="solas-announcer" role="status" aria-live="assertive" aria-atomic="true">
			{message}
		</div>
	)
}
