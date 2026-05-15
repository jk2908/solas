export namespace BasePath {
	/**
	 * Normalise a base path so every check uses the same shape
	 */
	export function normalise(value: string | null | undefined) {
		// no base means the app lives at the site root
		if (!value) return '/'
		if (value === '/' || value === '.' || value === './') return '/'

		let pathname = value.trim()
		if (!pathname) return '/'

		// plain path bases are the common case, so keep them cheap
		if (!pathname.startsWith('http://') && !pathname.startsWith('https://')) {
			const hashIndex = pathname.indexOf('#')
			const searchIndex = pathname.indexOf('?')
			const end =
				hashIndex === -1
					? searchIndex
					: searchIndex === -1
						? hashIndex
						: Math.min(hashIndex, searchIndex)

			if (end >= 0) pathname = pathname.slice(0, end)
		} else {
			try {
				// full urls can still show up here, but we only need the path part
				pathname = new URL(pathname).pathname
			} catch {
				// if parsing fails, fall back to the raw value below
			}
		}

		if (!pathname || pathname === '.' || pathname === './') return '/'

		// keep one stable shape: leading slash, trailing slash
		if (!pathname.startsWith('/')) pathname = `/${pathname}`
		return pathname.endsWith('/') ? pathname : `${pathname}/`
	}

	/**
	 * Strip the base path from a request path
	 */
	export function strip(pathname: string, base: string | null | undefined) {
		const normalisedBase = normalise(base)
		// root base means there is nothing to strip
		if (normalisedBase === '/') return pathname || '/'

		const basePath = normalisedBase.slice(0, -1)
		// treat both '/docs' and '/docs/' as the app root
		if (pathname === basePath || pathname === normalisedBase) return '/'
		// paths outside the base do not belong to this app
		if (!pathname.startsWith(`${basePath}/`)) return null

		// return the path as the app should see it
		return pathname.slice(basePath.length) || '/'
	}

	/**
	 * Add the base path to a path when needed
	 */
	export function apply(pathname: string, base: string | null | undefined) {
		const normalisedBase = normalise(base)
		// always work with a path-like value
		const target = pathname.startsWith('/') ? pathname : `/${pathname}`
		// root base means the path can pass through unchanged
		if (normalisedBase === '/') return target

		const basePath = normalisedBase.slice(0, -1)
		// leave it alone if the base is already there
		if (target === basePath || target.startsWith(`${basePath}/`)) return target
		// the app root maps to the base path itself
		if (target === '/') return normalisedBase

		// everything else sits underneath the base path
		return `${basePath}${target}`
	}
}
