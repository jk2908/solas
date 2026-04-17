'use client'

import { useEffect, useRef } from 'react'

import { BrowserRouter } from './router.js'
import { useRouter } from './use-router.js'

type AnchorProps = React.ComponentPropsWithRef<'a'> & { href: string }

type BaseProps = {
	prefetch?: 'intent' | 'hover' | 'none'
} & AnchorProps

type Props = BaseProps & BrowserRouter.LinkProps

function guard(path: string, prefetcher: (path: string) => void) {
	const connection = window.navigator.connection

	if (document.visibilityState === 'hidden') return
	if (connection?.saveData) return
	if (['2g', 'slow-2g'].includes(connection?.effectiveType ?? '')) return

	prefetcher(path)
}

/**
 * A link component that navigates to a given target
 * @param href - the route target to navigate to
 * @param prefetch - when to prefetch the linked page, defaults to 'none'
 * @param rest - other props to pass to the underlying anchor element
 * @returns a link element that navigates to the given target
 */
export function Link(props: Props): React.JSX.Element
export function Link({
	children,
	href,
	params,
	prefetch = 'none',
	query,
	...rest
}: Props) {
	const { go, prefetch: prefetcher } = useRouter()

	const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
	const handled = useRef(false)

	const target = BrowserRouter.toTarget(href, params, query)

	// clear any pending hover-prefetch timer on unmount
	useEffect(
		() => () => {
			if (timer.current) clearTimeout(timer.current)
		},
		[],
	)

	useEffect(() => {
		handled.current =
			BrowserRouter.isHashOnlyTarget(target) ||
			BrowserRouter.isExternalTarget(target, window.location.origin)
	}, [target])

	return (
		<a
			{...rest}
			href={target}
			onClick={e => {
				rest.onClick?.(e)
				if (e.defaultPrevented) return

				// only intercept plain left-click same-origin navigations
				if (e.button !== 0) return
				if (e.metaKey || e.altKey || e.ctrlKey || e.shiftKey) return
				if (rest.target && rest.target !== '_self') return
				if (rest.download) return
				if (handled.current) return

				e.preventDefault()
				go(href, { params, query })
			}}
			onFocus={e => {
				rest.onFocus?.(e)
				if (e.defaultPrevented) return
				if (prefetch !== 'intent') return
				if (handled.current) return

				guard(target, prefetcher)
			}}
			onTouchStart={e => {
				rest.onTouchStart?.(e)
				if (e.defaultPrevented) return
				if (prefetch !== 'intent') return
				if (handled.current) return

				guard(target, prefetcher)
			}}
			onMouseEnter={e => {
				rest.onMouseEnter?.(e)
				if (e.defaultPrevented) return
				if (prefetch !== 'hover') return
				if (handled.current) return

				timer.current = setTimeout(() => {
					guard(target, prefetcher)
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
