export namespace Time {
	export function debounce<T extends unknown[]>(fn: (...args: T) => void, wait: number) {
		let timeoutId: ReturnType<typeof setTimeout> | null = null

		return (...args: T) => {
			if (timeoutId) {
				clearTimeout(timeoutId)
			}

			timeoutId = setTimeout(() => {
				fn.apply(null, args)
			}, wait)
		}
	}

	export function withTimeout<T>(task: Promise<T>, timeoutMs: number, label: string) {
		let timer: ReturnType<typeof setTimeout> | undefined

		const timeout = new Promise<never>((_, reject) => {
			timer = setTimeout(() => {
				reject(new Error(`Timed out after ${timeoutMs}ms (${label})`))
			}, timeoutMs)
		})

		return Promise.race([task, timeout]).finally(() => {
			if (timer) clearTimeout(timer)
		})
	}
}
