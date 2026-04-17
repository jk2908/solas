import { use } from 'react'

import { BrowserRouterContext } from './router.js'

export function useRouter() {
	return use(BrowserRouterContext)
}
