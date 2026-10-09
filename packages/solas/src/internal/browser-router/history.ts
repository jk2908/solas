import * as BrowserRouter from './shared.js'

/**
 * A small in-memory mirror of browser history used by BrowserRouter.
 * It keeps local entries/index in sync with push/replace/go and
 * popstate updates.
 */
export class BrowserRouterHistory {
	#entries: BrowserRouter.HistoryEntry[]
	#index: number

	constructor(url: { pathname: string; search?: string; hash?: string }) {
		const entry: BrowserRouter.HistoryEntry = {
			pathname: url.pathname,
			search: url.search ?? '',
			hash: url.hash ?? '',
		}

		this.#entries = [entry]
		this.#index = 0
	}

	/**
	 * Returns a copy of tracked entries.
	 */
	get entries() {
		return [...this.#entries]
	}

	/**
	 * Returns the tracked history index.
	 */
	get index() {
		return this.#index
	}

	/**
	 * Returns the tracked history length.
	 */
	get length() {
		return this.#entries.length
	}

	/**
	 * Returns the current tracked entry.
	 */
	get current() {
		return this.#entries[this.#index] ?? null
	}

	/**
	 * Pushes a new history entry and advances the index.
	 */
	pushState(path: string) {
		if (this.#index < this.#entries.length - 1) {
			// drop forward entries when pushing from the middle
			this.#entries = this.#entries.slice(0, this.#index + 1)
		}

		window.history.pushState(null, '', path)

		const entry: BrowserRouter.HistoryEntry = {
			pathname: window.location.pathname,
			search: window.location.search,
			hash: window.location.hash,
		}

		this.#entries.push(entry)
		this.#index++

		return entry
	}

	/**
	 * Replaces the current history entry without changing length.
	 */
	replaceState(path: string) {
		window.history.replaceState(null, '', path)

		const entry: BrowserRouter.HistoryEntry = {
			pathname: window.location.pathname,
			search: window.location.search,
			hash: window.location.hash,
		}

		if (this.#entries.length === 0) {
			this.#entries = [entry]
			this.#index = 0
			return entry
		}

		this.#entries[this.#index] = entry
		return entry
	}

	/**
	 * Applies relative history movement and updates local index.
	 */
	go(delta: number) {
		if (!Number.isInteger(delta) || delta === 0) {
			return this.current
		}

		const nextIndex = Math.max(0, Math.min(this.#index + delta, this.#entries.length - 1))
		if (nextIndex !== this.#index) this.#index = nextIndex

		window.history.go(delta)

		return this.current
	}

	/**
	 * Syncs local index and entry from a popstate event.
	 */
	onPopState() {
		const current: BrowserRouter.HistoryEntry = {
			pathname: window.location.pathname,
			search: window.location.search,
			hash: window.location.hash,
		}
		const prev = this.#entries[this.#index - 1]
		const next = this.#entries[this.#index + 1]

		if (
			prev &&
			prev.pathname === current.pathname &&
			prev.search === current.search &&
			prev.hash === current.hash
		) {
			this.#index--
			this.#entries[this.#index] = current
			return current
		}

		if (
			next &&
			next.pathname === current.pathname &&
			next.search === current.search &&
			next.hash === current.hash
		) {
			this.#index++
			this.#entries[this.#index] = current
			return current
		}

		// fallback: locate an existing matching entry
		const index = this.#entries.findIndex(
			entry =>
				entry.pathname === current.pathname &&
				entry.search === current.search &&
				entry.hash === current.hash,
		)

		if (index >= 0) {
			this.#index = index
			this.#entries[index] = current
			return current
		}

		this.#entries.push(current)
		this.#index = this.#entries.length - 1

		return current
	}
}
