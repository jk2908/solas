'use client'

import { createContext, use, useEffect, useMemo, useRef } from 'react'

type Callback = () => void

export const DEFAULT_PREFETCH_MARGIN = '200px'

export type PrefetchObserver = {
	observe: (el: Element, callback: Callback) => void
	unobserve: (el: Element) => void
}

const PrefetchObserverContext = createContext<PrefetchObserver | null>(null)

export function usePrefetchObserver() {
	return use(PrefetchObserverContext)
}

function getObserver(
	callbacks: Map<Element, Callback>,
	observer: { current: IntersectionObserver | null },
) {
	if (observer.current) return observer.current
	if (typeof IntersectionObserver === 'undefined') return null

	observer.current = new IntersectionObserver(
		entries => {
			for (const entry of entries) {
				if (!entry.isIntersecting) continue

				const callback = callbacks.get(entry.target)
				if (!callback) continue

				callbacks.delete(entry.target)
				observer.current?.unobserve(entry.target)
				callback()
			}

			if (callbacks.size === 0) {
				observer.current?.disconnect()
				observer.current = null
			}
		},
		{ rootMargin: DEFAULT_PREFETCH_MARGIN },
	)

	return observer.current
}

export function PrefetchObserverProvider({ children }: { children: React.ReactNode }) {
	const callbacks = useRef(new Map<Element, Callback>())
	const observer = useRef<IntersectionObserver | null>(null)

	const value = useMemo<PrefetchObserver>(
		() => ({
			observe(el, callback) {
				callbacks.current.set(el, callback)
				getObserver(callbacks.current, observer)?.observe(el)
			},
			unobserve(el) {
				callbacks.current.delete(el)

				if (callbacks.current.size === 0) {
					observer.current?.disconnect()
					observer.current = null
					return
				}

				observer.current?.unobserve(el)
			},
		}),
		[],
	)

	useEffect(
		() => () => {
			observer.current?.disconnect()
			callbacks.current.clear()
			observer.current = null
		},
		[value],
	)

	return <PrefetchObserverContext value={value}>{children}</PrefetchObserverContext>
}
