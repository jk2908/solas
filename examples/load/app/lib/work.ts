/**
 * Deterministic CPU work shared by the server and client stress routes.
 * The result is used by the caller, so engines cannot drop the loop.
 */
export function burn(seed: number, iterations: number) {
	let hash = seed >>> 0

	for (let index = 0; index < iterations; index += 1) {
		hash = Math.imul(hash ^ (index + 0x9e3779b9), 0x85ebca6b)
		hash ^= hash >>> 13
		hash = Math.imul(hash, 0xc2b2ae35)
		hash ^= hash >>> 16
	}

	return hash >>> 0
}

/**
 * Read a bounded integer from the query string, falling back when absent or
 * invalid so a stray value cannot make a benchmark unresponsive.
 */
export function clampInt(
	value: string | null,
	fallback: number,
	min: number,
	max: number,
) {
	if (value === null || value === '') return fallback

	const parsed = Number(value)
	if (!Number.isFinite(parsed)) return fallback

	return Math.min(max, Math.max(min, Math.trunc(parsed)))
}
