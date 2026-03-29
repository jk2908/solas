import { AsyncLocalStorage } from 'node:async_hooks'

import { Logger } from './logger'

const logger = new Logger()

export namespace Context {
	export function create<T>(name: string) {
		const storage = new AsyncLocalStorage<T>()

		return {
			use() {
				const r = storage.getStore()

				if (!r) {
					const error = new Error(`No ${name} context available`)
					logger.error(`[Context:create] ${error.message}`, error)

					throw error
				}

				return r
			},
			write<R>(value: T, fn: () => R | Promise<R>) {
				return storage.run(value, fn)
			},
		}
	}
}
