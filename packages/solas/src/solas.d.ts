import type { ImportMap, Manifest } from './types'

declare module 'solas/manifest' {
	export const manifest: Manifest
}

declare module 'solas/import-map' {
	export const importMap: ImportMap
}
