import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

import * as Events from '../../events.js'

/**
 * Announces the new document title after client-side navigation through a
 * screen-reader only live region.
 */
export function RouteAnnouncer() {
	const [message, setMessage] = useState('')

	useEffect(() => {
		let frame: number | undefined

		function announce() {
			if (frame !== undefined) cancelAnimationFrame(frame)

			setMessage('')
			frame = requestAnimationFrame(() => {
				setMessage(document.title)
			})
		}

		window.addEventListener(Events.names.NAVIGATION_COMMITTED, announce)

		return () => {
			window.removeEventListener(Events.names.NAVIGATION_COMMITTED, announce)
			if (frame !== undefined) cancelAnimationFrame(frame)
		}
	}, [])

	return createPortal(
		<div
			className="solas-announcer"
			role="status"
			aria-live="assertive"
			aria-atomic="true">
			{message}
		</div>,
		document.body,
	)
}
