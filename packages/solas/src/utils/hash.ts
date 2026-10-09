import { createHash } from 'node:crypto'

/**
 * Deterministic 16-character hex hash, used for stable entry ids.
 */
export function hash(value: string) {
	return createHash('sha256').update(value).digest('hex').slice(0, 16)
}
