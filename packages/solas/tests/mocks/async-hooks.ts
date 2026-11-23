/**
 * Browser-test shim for server render contexts. Tree tests only cover static rendering;
 * they do not need real async context propagation.
 */
export class AsyncLocalStorage<T> {
	#store: T | undefined

	getStore() {
		return this.#store
	}

	run<R>(store: T, callback: () => R): R {
		const previous = this.#store
		this.#store = store

		try {
			return callback()
		} finally {
			this.#store = previous
		}
	}
}
