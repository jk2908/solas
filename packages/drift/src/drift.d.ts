import type { ImportMap, Manifest } from './types'

declare module 'drift/manifest' {
	export const manifest: Manifest
}

declare module 'drift/import-map' {
	export const importMap: ImportMap
}
