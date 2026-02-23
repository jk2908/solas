import { use } from 'react'

import { RouterContext } from './router-context'

export function useRouter() {
	return use(RouterContext)
}
