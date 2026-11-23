import { use } from 'react'

import { BrowserRouterActionsContext, BrowserRouterContext } from './router.js'

export function useRouter() {
	return use(BrowserRouterContext)
}

export function useRouterActions() {
	return use(BrowserRouterActionsContext)
}
