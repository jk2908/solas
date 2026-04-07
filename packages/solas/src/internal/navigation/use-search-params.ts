import { useMemo, useSyncExternalStore } from 'react'

import { Solas } from '../../solas.js'
import { useRouter } from '../router/use-router.js'

export type ReadonlySearchParams = Iterable<[string, string]> & {
	entries(): IterableIterator<[string, string]>
	forEach(
		callbackfn: (value: string, key: string, parent: ReadonlySearchParams) => void,
		thisArg?: unknown,
	): void
	get(name: string): string | null
	getAll(name: string): string[]
	has(name: string, value?: string): boolean
	keys(): IterableIterator<string>
	toString(): string
	values(): IterableIterator<string>
}

function createReadonlySearchParams(search: string | undefined): ReadonlySearchParams {
	const params = new URLSearchParams(search)

	const readonlyParams: ReadonlySearchParams = {
		[Symbol.iterator]: () => params[Symbol.iterator](),
		entries: () => params.entries(),
		forEach: (callbackfn, thisArg) => {
			params.forEach((value, key) => {
				callbackfn.call(thisArg, value, key, readonlyParams)
			})
		},
		get: name => params.get(name),
		getAll: name => params.getAll(name),
		has: (name, value) => params.has(name, value),
		keys: () => params.keys(),
		toString: () => params.toString(),
		values: () => params.values(),
	}

	return readonlyParams
}

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

	return useMemo(() => createReadonlySearchParams(search), [search])
}
