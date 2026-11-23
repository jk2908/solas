import { AsyncLocalStorage } from 'node:async_hooks'

import { Logger } from './logger.js'

const logger = new Logger()

export function create<T>(name: string) {
	const storage = typeof window === 'undefined' ? new AsyncLocalStorage<T>() : null

	return {
		use() {
			const r = storage?.getStore()

			if (!r) {
				const error = new Error(`No ${name} context available`)
				logger.error(`[Context:create] ${error.message}`, error)

				throw error
			}

			return r
		},
		tryUse() {
			return storage?.getStore()
		},
		write<R>(value: T, fn: () => R | Promise<R>) {
			return storage ? storage.run(value, fn) : fn()
		},
	}
}
