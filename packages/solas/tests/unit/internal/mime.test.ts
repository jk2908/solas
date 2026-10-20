import { describe, it, expect } from 'vitest'

import { getMimeTypeFromPath } from '../../../src/internal/mime.js'

describe('getMimeTypeFromPath', () => {
	it('returns correct MIME types', () => {
		expect(getMimeTypeFromPath('/index.html')).toContain('text/html')
		expect(getMimeTypeFromPath('/style.css')).toContain('text/css')
		expect(getMimeTypeFromPath('/app.js')).toContain('text/javascript')
		expect(getMimeTypeFromPath('/image.png')).toBe('image/png')
		expect(getMimeTypeFromPath('/image.jpg')).toBe('image/jpeg')
		expect(getMimeTypeFromPath('/image.jpeg')).toBe('image/jpeg')
		expect(getMimeTypeFromPath('/image.gif')).toBe('image/gif')
		expect(getMimeTypeFromPath('/image.webp')).toBe('image/webp')
		expect(getMimeTypeFromPath('/image.avif')).toBe('image/avif')
		expect(getMimeTypeFromPath('/favicon.ico')).toBe('image/x-icon')
		expect(getMimeTypeFromPath('/font.woff')).toBe('font/woff')
		expect(getMimeTypeFromPath('/font.woff2')).toBe('font/woff2')
		expect(getMimeTypeFromPath('/data.json')).toContain('application/json')
		expect(getMimeTypeFromPath('/app.wasm')).toBe('application/wasm')
		expect(getMimeTypeFromPath('/video.mp4')).toBe('video/mp4')
		expect(getMimeTypeFromPath('/audio.mp3')).toBe('audio/mpeg')
	})

	it('returns octet-stream for unknown extensions', () => {
		expect(getMimeTypeFromPath('/file.xyz')).toBe('application/octet-stream')
		expect(getMimeTypeFromPath('/file')).toBe('application/octet-stream')
	})

	it('handles uppercase extensions', () => {
		expect(getMimeTypeFromPath('/image.JPG')).toBe('image/jpeg')
		expect(getMimeTypeFromPath('/style.CSS')).toContain('text/css')
	})
})
