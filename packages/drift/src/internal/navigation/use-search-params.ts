import { useMemo, useSyncExternalStore } from 'react'

import { Drift } from '../../drift'

export function useSearchParams() {
	const search = useSyncExternalStore(
		fn => {
			window.addEventListener('popstate', fn)
			window.addEventListener(Drift.Events.names.NAVIGATION, fn)

			return () => {
				window.removeEventListener('popstate', fn)
				window.removeEventListener(Drift.Events.names.NAVIGATION, fn)
			}
		},
		() => window.location.search,
		() => '',
	)

	return useMemo(() => new URLSearchParams(search), [search])
}
