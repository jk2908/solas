import { useMemo, useSyncExternalStore } from 'react'

import * as Events from '../../events.js'
import { useRouter } from '../browser-router/use-router.js'

export function useSearchParams() {
	const { url } = useRouter()

	const search = useSyncExternalStore(
		fn => {
			window.addEventListener('popstate', fn)
			window.addEventListener(Events.NAVIGATION, fn)

			return () => {
				window.removeEventListener('popstate', fn)
				window.removeEventListener(Events.NAVIGATION, fn)
			}
		},
		() => window.location.search,
		() => url?.search,
	)

	return useMemo(() => new URLSearchParams(search), [search])
}
