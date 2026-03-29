import { useMemo, useSyncExternalStore } from 'react'

import { Solas } from '../../solas'

export function useSearchParams() {
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
		() => '',
	)

	return useMemo(() => new URLSearchParams(search), [search])
}
