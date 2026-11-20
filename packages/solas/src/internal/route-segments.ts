export type RscSegment = {
	layouts: (string | null)[]
	page: string | null
}

export type RscSegmentDescriptor = {
	id: string
	kind: 'shell' | 'layout' | 'page'
}

/**
 * Convert a route's layout/page paths into the segment list sent to the server.
 */
export function describeSegments(segments: RscSegment): RscSegmentDescriptor[] {
	const layouts = segments.layouts.filter((id): id is string => typeof id === 'string')
	const descriptors = layouts.map(
		(id, index): RscSegmentDescriptor => ({
			id,
			kind: index === 0 ? 'shell' : 'layout',
		}),
	)

	if (segments.page) descriptors.push({ id: segments.page, kind: 'page' })

	return descriptors
}
