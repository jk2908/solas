import { use } from 'react'

import { RouterContext } from './router-provider'

export function useRouter() {
	return use(RouterContext)
}
