export namespace Config {
	export const NAME = 'drift'
	export const PKG_NAME = `@jk2908/${NAME}`
	export const APP_DIR = 'app'
	export const GENERATED_DIR = `.${NAME}`
	export const ENTRY_RSC = 'entry.rsc.tsx'
	export const ENTRY_SSR = 'entry.ssr.tsx'
	export const ENTRY_BROWSER = 'entry.browser.tsx'
	export const INJECT_RUNTIME = `$$$RUNTIME$$$`
	export const ASSETS_DIR = 'assets'
	export const DRIFT_PAYLOAD_ID = `__${NAME.toUpperCase()}_DATA__`
}
