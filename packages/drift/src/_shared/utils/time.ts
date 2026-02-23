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
}
