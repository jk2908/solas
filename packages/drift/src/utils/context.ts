import { AsyncLocalStorage } from 'node:async_hooks'

export namespace Context {
	export function create<T>(name: string) {
		const storage = new AsyncLocalStorage<T>()

		return {
			use() {
				const r = storage.getStore()

				if (!r) {
					throw new Error(`No ${name} context available`)
				}

				return r
			},
			write<R>(value: T, fn: () => R | Promise<R>) {
				return storage.run(value, fn)
			},
		}
	}
}
