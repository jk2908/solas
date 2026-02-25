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
			const [raw, ...rest] = part.split('=')

			const key = raw?.trim()

			if (!key) continue
			if (out.has(key)) continue

			const value = rest.join('=').trim()
			out.set(key, decode(value))
		}

		return out
	}
}
