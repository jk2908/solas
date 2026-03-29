'use client'

import { createContext } from 'react'

export namespace Navigation {
	export type GoOptions = {
		replace?: boolean
		query?: Record<string, string | number | boolean>
	}
}

export const RouterContext = createContext<{
	go: (to: string, opts?: Navigation.GoOptions) => Promise<string>
	prefetch: (path: string) => void
	isNavigating: boolean
}>({
	go: async () => '',
	prefetch: () => {},
	isNavigating: false,
})
