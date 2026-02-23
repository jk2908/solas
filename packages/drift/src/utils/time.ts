export namespace Time {
	export function debounce(fn: (...args: any[]) => any, wait: number) {
		let timeoutId: ReturnType<typeof setTimeout> | null = null

		return (...args: any[]) => {
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
				reject(new Error(`timed out after ${timeoutMs}ms (${label})`))
			}, timeoutMs)
		})

		return Promise.race([task, timeout]).finally(() => {
			if (timer) clearTimeout(timer)
		})
	}
}
