import { isCSSRequest, type Plugin } from 'vite'

/**
 * Vite's scan environment executes route modules to read `staticParams` and
 * `prerender` exports. It does not run per-environment `buildStart` hooks, so
 * Vite's CSS plugin cache is not initialised. Route modules can import CSS
 * indirectly through other plugins, so stub CSS for the scan only.
 *
 * The virtual id deliberately has no CSS extension: Vite's CSS plugin matches
 * on the raw id and would otherwise still try to transform it.
 */
const CSS_STUB_PREFIX = '\0solas-scan-css:'
const CSS_INLINE_STUB_PREFIX = '\0solas-scan-css-inline:'
const SPECIAL_QUERY_RE = /[?&](?:worker|sharedworker|raw|url)\b/
const INLINE_QUERY_RE = /[?&]inline\b/

function virtualId(prefix: string, id: string) {
	return `${prefix}${encodeURIComponent(id).replaceAll('.', '%2E')}`
}

export function createScanCssStubPlugin(): Plugin {
	return {
		name: 'solas:scan-css-stub',
		enforce: 'pre',
		resolveId(id) {
			if (!isCSSRequest(id) || SPECIAL_QUERY_RE.test(id)) return

			const prefix = INLINE_QUERY_RE.test(id) ? CSS_INLINE_STUB_PREFIX : CSS_STUB_PREFIX

			return virtualId(prefix, id)
		},
		load(id) {
			if (id.startsWith(CSS_STUB_PREFIX)) return 'export default {}'
			if (id.startsWith(CSS_INLINE_STUB_PREFIX)) return 'export default ""'
		},
	}
}
