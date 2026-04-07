import { use } from 'react'

import { RouterContext } from './router-context.js'

export function useRouter() {
	return use(RouterContext)
}
