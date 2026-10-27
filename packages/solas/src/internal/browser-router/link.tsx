'use client'

import { useEffect, useImperativeHandle, useRef } from 'react'

import { usePrefetchObserver } from './prefetch-observer.js'
import * as BrowserRouter from './shared.js'
import { useRouter } from './use-router.js'

type AnchorProps = React.ComponentPropsWithRef<'a'> & { href: string }

type PrefetchMode = 'intent' | 'hover' | 'viewport' | 'auto'

type BaseProps = {
	prefetch?: PrefetchMode | false
} & AnchorProps

type Props = BaseProps & BrowserRouter.LinkProps

const HOVER_DELAY = 100

function guard(path: string, prefetcher: (path: string) => void) {
	const connection = window.navigator.connection

	if (document.visibilityState === 'hidden') return
	if (connection?.saveData) return
	if (['2g', 'slow-2g'].includes(connection?.effectiveType ?? '')) return

	prefetcher(path)
}

function getPrefetchStrategy(
	prefetch: PrefetchMode | false,
	hover: boolean,
	hasObserver: boolean,
) {
	if (prefetch !== 'auto') return prefetch
	if (hover) return 'hover'

	return hasObserver ? 'viewport' : 'intent'
}

/**
 * A link component that navigates to a given target.
 * @param href - The route target to navigate to.
 * @param prefetch - When to prefetch the linked page, defaults to false.
 * @param rest - Other props to pass to the underlying anchor element.
 * @returns A link element that navigates to the given target.
 */
export function Link(props: Props): React.JSX.Element
export function Link({
	children,
	href,
	params,
	prefetch = false,
	query,
	ref,
	scroll,
	...rest
}: Props) {
	const { go, prefetch: prefetcher } = useRouter()
	const observer = usePrefetchObserver()

	const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
	const anchor = useRef<HTMLAnchorElement | null>(null)
	const handled = useRef(false)

	const { onClick, onFocus, onTouchStart, onMouseEnter, onMouseLeave, ...anchorProps } =
		rest

	const target = BrowserRouter.toTarget(href, params, query)

	const hoverable =
		typeof window !== 'undefined' &&
		typeof window.matchMedia === 'function' &&
		window.matchMedia('(hover: hover) and (pointer: fine)').matches
	const observable = typeof IntersectionObserver !== 'undefined'

	const prefetchStrategy = getPrefetchStrategy(prefetch, hoverable, observable)

	useImperativeHandle(ref, () => anchor.current!, [])

	function navigate(e: React.MouseEvent<HTMLAnchorElement>) {
		onClick?.(e)
		if (e.defaultPrevented) return
		if (e.button !== 0) return
		if (e.metaKey || e.altKey || e.ctrlKey || e.shiftKey) return
		if (anchorProps.target && anchorProps.target !== '_self') return
		if (anchorProps.download || handled.current) return

		e.preventDefault()
		go(href, { params, query, scroll })
	}

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

	useEffect(() => {
		const node = anchor.current

		if (!node || prefetchStrategy !== 'viewport' || !observable || !observer) return
		if (
			BrowserRouter.isHashOnlyTarget(target) ||
			BrowserRouter.isExternalTarget(target, window.location.origin)
		) {
			return
		}

		observer.observe(node, () => guard(target, prefetcher))
		return () => observer.unobserve(node)
	}, [observable, observer, prefetcher, prefetchStrategy, target])

	return (
		<a
			{...anchorProps}
			ref={anchor}
			href={target}
			onClick={navigate}
			onFocus={e => {
				onFocus?.(e)
				if (prefetchStrategy !== 'intent' || e.defaultPrevented || handled.current) return

				guard(target, prefetcher)
			}}
			onTouchStart={e => {
				onTouchStart?.(e)
				if (prefetchStrategy !== 'intent' || e.defaultPrevented || handled.current) return

				guard(target, prefetcher)
			}}
			onMouseEnter={e => {
				onMouseEnter?.(e)
				if (prefetchStrategy !== 'hover' || e.defaultPrevented || handled.current) return

				timer.current = setTimeout(() => {
					guard(target, prefetcher)
				}, HOVER_DELAY)
			}}
			onMouseLeave={e => {
				onMouseLeave?.(e)

				if (timer.current) {
					clearTimeout(timer.current)
					timer.current = null
				}
			}}>
			{children}
		</a>
	)
}
