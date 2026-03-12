export namespace Cookies {
	function decode(value: string) {
		try {
			// some clients encode spaces as '+'
			return decodeURIComponent(value.replace(/\+/g, ' '))
		} catch {
			// keep raw value if decoding fails
			return value
		}
	}

	export function parse(header: string | null | undefined) {
		const out = new Map<string, string>()
		if (!header) return out

		for (const part of header.split(';')) {
			// cookie values may contain =, so only split on the
			// first separator
			const separator = part.indexOf('=')
			const raw = separator === -1 ? part : part.slice(0, separator)
			const key = raw.trim()

			if (!key) continue
			// later duplicates are ignored so the first cookie value wins
			if (out.has(key)) continue

			const value = separator === -1 ? '' : part.slice(separator + 1).trim()
			out.set(key, decode(value))
		}

		return out
	}
}
