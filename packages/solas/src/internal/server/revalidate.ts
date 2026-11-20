const invalidatedTags = new Set<string>()

/**
 * Mark cached segment data as stale.
 */
export function revalidateTag(tag: string) {
	if (tag) invalidatedTags.add(tag)
}

/**
 * Drain tags invalidated during the current action request.
 */
export function drainRevalidatedTags() {
	const tags = [...invalidatedTags]
	invalidatedTags.clear()
	return tags
}
