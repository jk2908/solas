'use client'

import { createContext } from 'react'

export type GoConfig = {
	replace?: boolean
	query?: Record<string, string | number | boolean>
}

export const RouterContext = createContext<{
	go: (to: string, config?: GoConfig) => Promise<string>
	prefetch: (path: string) => void
	isNavigating: boolean
}>({
	go: async () => '',
	prefetch: () => {},
	isNavigating: false,
})
