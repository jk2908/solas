import { describe, it, expect, afterAll } from 'vitest'

import {
	captureBuffered,
	completeShellPayload,
	injectPayload,
	rscStream,
} from '../../../../src/internal/env/flight.js'

// drain the global rscStream after tests to prevent ERR_INVALID_STATE
afterAll(() => {
	rscStream.cancel()
})

describe('captureBuffered', () => {
	it('captures queued chunks from a stream', async () => {
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new TextEncoder().encode('hello '))
				controller.enqueue(new TextEncoder().encode('world'))
				controller.close()
			},
		})

		const captured = await captureBuffered(stream)
		const reader = captured.getReader()
		const chunks: Uint8Array[] = []
		while (true) {
			const { done, value } = await reader.read()
			if (done) break
			if (value) chunks.push(value)
		}

		const result = chunks.map(c => new TextDecoder().decode(c)).join('')
		expect(result).toBe('hello world')
	})

	it('returns empty stream when no queued chunks', async () => {
		const stream = new ReadableStream<Uint8Array>({
			start() {},
		})

		const captured = await captureBuffered(stream)
		const reader = captured.getReader()
		const chunks: Uint8Array[] = []
		while (true) {
			const { done, value } = await reader.read()
			if (done) break
			if (value) chunks.push(value)
		}

		expect(chunks.length).toBe(0)
	})
})

describe('completeShellPayload', () => {
	it('resolves postponed lazy references to their suspense fallback', () => {
		const payload = [
			'3:I["module",[],"Link",1]',
			'8:"$Sreact.suspense"',
			'0:{"root":["$","div",null,{"children":[["$","$L3",null,{}],["$","$8",null,{"fallback":["$","p",null,{"children":"Loading"}],"children":"$L9"}]]}]}',
		].join('\n')

		const result = completeShellPayload(payload)

		expect(result).toContain('9:["$","p",null,{"children":"Loading"}]')
		expect(result).not.toContain('3:null')
	})

	it('returns the payload unchanged when there are no missing references', () => {
		const payload = '0:{"root":["$","div",null,{"children":"ready"}]}'

		expect(completeShellPayload(payload)).toBe(payload)
	})
})

describe('injectPayload', () => {
	it('returns a TransformStream', () => {
		const payload = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.close()
			},
		})
		const result = injectPayload(payload)
		expect(result).toBeInstanceOf(TransformStream)
	})

	it('passes html through and appends payload scripts before closing tags', async () => {
		const payload = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new TextEncoder().encode('RSC:data'))
				controller.close()
			},
		})

		const transform = injectPayload(payload)
		const input = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new TextEncoder().encode('<html><body>'))
				controller.enqueue(new TextEncoder().encode('</body></html>'))
				controller.close()
			},
		})

		const output = input.pipeThrough(transform)
		const reader = output.getReader()
		const chunks: Uint8Array[] = []
		while (true) {
			const { done, value } = await reader.read()
			if (done) break
			if (value) chunks.push(value)
		}

		const html = chunks.map(c => new TextDecoder().decode(c)).join('')
		expect(html).toContain('<html><body>')
		expect(html).toContain('__FLIGHT_DATA')
		expect(html).toContain('</body></html>')
	})

	it('accepts nonce attribute', async () => {
		const payload = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new TextEncoder().encode('data'))
				controller.close()
			},
		})

		const transform = injectPayload(payload, { nonce: 'abc123' })
		const input = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new TextEncoder().encode('<html></html>'))
				controller.close()
			},
		})

		const output = input.pipeThrough(transform)
		const reader = output.getReader()
		const chunks: Uint8Array[] = []
		while (true) {
			const { done, value } = await reader.read()
			if (done) break
			if (value) chunks.push(value)
		}

		const html = chunks.map(c => new TextDecoder().decode(c)).join('')
		expect(html).toContain('nonce="abc123"')
	})
})

describe('rscStream', () => {
	it('is a ReadableStream', () => {
		expect(rscStream).toBeInstanceOf(ReadableStream)
	})
})
