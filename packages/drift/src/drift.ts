export namespace Drift {
	export namespace Config {
		export const NAME = 'drift'
		export const PKG_NAME = `@jk2908/${NAME}`
		export const APP_DIR = 'app'
		export const GENERATED_DIR = `.${NAME}`
		export const ENTRY_RSC = 'entry.rsc.tsx'
		export const ENTRY_SSR = 'entry.ssr.tsx'
		export const ENTRY_BROWSER = 'entry.browser.tsx'
		export const ASSETS_DIR = 'assets'
		export const $ = Symbol(NAME)
	}

	let version: string | undefined

	/**
	 * Get the Drift framework version from this package's package.json
	 */
	export function getVersion() {
		if (version) return version

		const value = (import.meta.env as Record<string, unknown>).DRIFT_VERSION

		if (typeof value !== 'string' || value.length === 0) {
			throw new Error('Missing package.json version')
		}

		version = value
		return version
	}
}
