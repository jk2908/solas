import type { ImportMap, Manifest } from './types.js'

declare module 'solas/manifest' {
	export const manifest: Manifest
}

declare module 'solas/import-map' {
	export const importMap: ImportMap
}
