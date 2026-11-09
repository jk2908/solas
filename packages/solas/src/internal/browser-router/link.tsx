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

/**
 * Run viewport prefetch work only after the page has loaded and the browser is
 * idle, so it does not compete with first paint or startup.
 */
function deferUntilIdle(callback: () => void) {
	if (typeof window === 'undefined') return () => {}

	let cancelled = false
	let idleId: number | undefined
	let timeoutId: ReturnType<typeof setTimeout> | undefined

	function schedule() {
		if (cancelled) return

		if (typeof window.requestIdleCallback === 'function') {
			idleId = window.requestIdleCallback(callback, { timeout: 2000 })
			return
		}

		timeoutId = setTimeout(callback, 200)
	}

	function run() {
		if (cancelled) return
		schedule()
	}

	if (document.readyState === 'complete') {
		schedule()
	} else {
		window.addEventListener('load', run, { once: true })
	}

	return () => {
		cancelled = true
		window.removeEventListener('load', run)
		if (idleId !== undefined) window.cancelIdleCallback(idleId)
		if (timeoutId !== undefined) clearTimeout(timeoutId)
	}
}

function isCurrent(path: string) {
	try {
		const url = new URL(path, window.location.href)

		return (
			url.pathname === window.location.pathname && url.search === window.location.search
		)
	} catch {
		return false
	}
}

function guard(path: string, prefetcher: (path: string) => void) {
	if (document.visibilityState === 'hidden') return

	const connection = window.navigator.connection

	if (connection?.saveData) return
	if (['2g', 'slow-2g'].includes(connection?.effectiveType ?? '')) return
	if (isCurrent(path)) return

	prefetcher(path)
}

function getPrefetchStrategy(
	prefetch: PrefetchMode | false,
	hoverable: boolean,
	observable: boolean,
) {
	if (prefetch !== 'auto') return prefetch
	if (hoverable) return 'hover'

	return observable ? 'viewport' : 'intent'
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

		// defer viewport prefetch until load and idle to avoid competing with first paint
		const cancel = deferUntilIdle(() => {
			observer.observe(node, () => guard(target, prefetcher))
		})

		return () => {
			cancel()
			observer.unobserve(node)
		}
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
