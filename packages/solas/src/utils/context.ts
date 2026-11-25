import { AsyncLocalStorage } from 'node:async_hooks'

import { ErrorCode, SolasError } from './errors.js'
import { createLogger } from './logger.js'

const logger = createLogger('context')

export function create<T>(name: string) {
	const storage = new AsyncLocalStorage<T>()

	return {
		get() {
			return storage.getStore()
		},
		use() {
			const r = storage.getStore()

			if (!r) {
				const error = new SolasError(
					ErrorCode.ContextMissing,
					`no ${name} context is available`,
					{
						hint: 'Call this after the runtime has set up the request context.',
					},
				)
				logger.error(error)

				throw error
			}

			return r
		},
		write<R>(value: T, fn: () => R) {
			return storage.run(value, fn)
		},
	}
}
