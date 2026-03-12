'use client'

import { useRef } from 'react'

import { useRouter } from '../router/use-router'

type Props = {
	href: string
	prefetch?: 'intent' | 'hover' | 'none'
} & React.ComponentPropsWithRef<'a'>

/**
 * A link component that navigates to a given href
 * @param href - the href to navigate to
 * @param prefetch - when to prefetch the linked page, defaults to 'intent'
 * @param rest - other props to pass to the underlying anchor element
 * @returns a link element that navigates to the given href
 */
export function Link({ children, href, prefetch = 'intent', ...rest }: Props) {
	const { go, prefetch: prefetcher } = useRouter()
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

	return (
		<a
			{...rest}
			href={href}
			onClick={e => {
				rest.onClick?.(e)
				if (e.defaultPrevented) return

				// only intercept plain left-click same-origin navigations
				if (e.button !== 0) return
				if (e.metaKey || e.altKey || e.ctrlKey || e.shiftKey) return
				if (rest.target && rest.target !== '_self') return
				if (rest.download) return

				const to = new URL(href, window.location.origin)
				if (to.origin !== window.location.origin) return

				e.preventDefault()
				go(to.pathname + to.search + to.hash)
			}}
			onFocus={e => {
				rest.onFocus?.(e)
				if (e.defaultPrevented) return

				if (prefetch !== 'intent') return
				prefetcher(href)
			}}
			onTouchStart={e => {
				rest.onTouchStart?.(e)
				if (e.defaultPrevented) return

				if (prefetch !== 'intent') return
				prefetcher(href)
			}}
			onMouseEnter={e => {
				rest.onMouseEnter?.(e)
				if (e.defaultPrevented) return
				if (prefetch !== 'hover') return

				timer.current = setTimeout(() => {
					prefetcher(href)
				}, 100)
			}}
			onMouseLeave={e => {
				rest.onMouseLeave?.(e)

				if (timer.current) {
					clearTimeout(timer.current)
					timer.current = null
				}
			}}>
			{children}
		</a>
	)
}
