import { useMemo, useSyncExternalStore } from 'react'

export function useSearchParams() {
	const search = useSyncExternalStore(
		fn => {
			window.addEventListener('popstate', fn)
			window.addEventListener('driftnavigation', fn)

			return () => {
				window.removeEventListener('popstate', fn)
				window.removeEventListener('driftnavigation', fn)
			}
		},
		() => window.location.search,
		() => '',
	)

	return useMemo(() => new URLSearchParams(search), [search])
}
