import fs from 'node:fs/promises'

/**
 * Check whether a file or directory exists.
 */
export async function exists(filePath: string) {
	try {
		await fs.access(filePath)
		return true
	} catch {
		return false
	}
}
