import { useMemo, useSyncExternalStore } from 'react'

import { useRouter } from '../../router.js'
import { Solas } from '../../solas.js'

export function useSearchParams() {
	const { url } = useRouter()

	const search = useSyncExternalStore(
		fn => {
			window.addEventListener('popstate', fn)
			window.addEventListener(Solas.Events.names.NAVIGATION, fn)

			return () => {
				window.removeEventListener('popstate', fn)
				window.removeEventListener(Solas.Events.names.NAVIGATION, fn)
			}
		},
		() => window.location.search,
		() => url?.search,
	)

	return useMemo(() => new URLSearchParams(search), [search])
}
