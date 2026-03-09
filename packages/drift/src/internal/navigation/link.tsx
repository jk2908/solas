'use client'

import { useRef } from 'react'

import { useRouter } from '../router/use-router'

type Props = {
	href: string
	preload?: 'intent' | 'hover' | 'none'
} & React.ComponentPropsWithRef<'a'>

/**
 * A link component that navigates to a given href
 * @param href - the href to navigate to
 * @param preload - when to preload the linked page, defaults to 'intent'
 * @param props - the props to pass to the link
 * @returns a link element that navigates to the given href
 */
export function Link({ children, href, preload = 'intent', ...props }: Props) {
	const { go, preload: preloader } = useRouter()
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

	return (
		<a
			{...props}
			href={href}
			onClick={e => {
				props.onClick?.(e)
				if (e.defaultPrevented) return

				// only intercept plain left-click same-origin navigations
				if (e.button !== 0) return
				if (e.metaKey || e.altKey || e.ctrlKey || e.shiftKey) return
				if (props.target && props.target !== '_self') return
				if (props.download) return

				const to = new URL(href, window.location.origin)
				if (to.origin !== window.location.origin) return

				e.preventDefault()
				go(to.pathname + to.search + to.hash)
			}}
			onFocus={e => {
				props.onFocus?.(e)
				if (e.defaultPrevented) return

				if (preload !== 'intent') return
				preloader(href)
			}}
			onTouchStart={e => {
				props.onTouchStart?.(e)
				if (e.defaultPrevented) return

				if (preload !== 'intent') return
				preloader(href)
			}}
			onMouseEnter={e => {
				props.onMouseEnter?.(e)
				if (e.defaultPrevented) return
				if (preload !== 'hover') return

				timer.current = setTimeout(() => {
					preloader(href)
				}, 100)
			}}
			onMouseLeave={e => {
				props.onMouseLeave?.(e)

				if (timer.current) {
					clearTimeout(timer.current)
					timer.current = null
				}
			}}>
			{children}
		</a>
	)
}
