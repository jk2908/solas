/**
 * Convert Windows path separators to forward slashes.
 */
export function normalisePath(value: string) {
	return value.replace(/\\/g, '/')
}
