type Chunk = string | Uint8Array

type Opts = {
	nonce?: string
}

declare global {
	interface Window {
		__FLIGHT_DATA?: Chunk[]
	}
}

const encoder = new TextEncoder()
const HTML_TRAIL = '</body></html>'

/**
 * Capture only the payload rows that are already buffered in a stream.
 * Used by ppr prerender so the cached prelude carries the static
 * payload, while postponed work is left for request-time resume
 */
export async function captureBuffered(stream: ReadableStream<Uint8Array>) {
	const reader = stream.getReader()
	const chunks: Uint8Array[] = []

	try {
		while (true) {
			// only take what is already queued. anything still pending belongs
			// to the later resume step, not the cached prelude
			const result = await Promise.race([
				reader.read(),
				new Promise<null>(r => setTimeout(r, 0, null)),
			])

			if (result === null || result.done) break
			if (result.value) chunks.push(result.value)
		}
	} finally {
		reader.cancel()
	}

	return new ReadableStream<Uint8Array>({
		start(controller) {
			for (const chunk of chunks) controller.enqueue(chunk)
			controller.close()
		},
	})
}

/**
 * Read the inline payload rows written into the html document. Stays open
 * for the lifetime of the document so ppr resume can keep appending rows
 * without tripping React's connection-closed path
 */
export const rscStream = new ReadableStream<Uint8Array>({
	start(controller) {
		if (typeof window === 'undefined') return

		// start with any rows already written into the page. Later resume
		// work keeps adding to this same array
		const flightData = (window.__FLIGHT_DATA ??= [])

		// save the real array push before we replace it. We still want
		// __FLIGHT_DATA to behave like a normal array
		const push = flightData.push.bind(flightData)

		// each row can be plain text or binary. normalise both into bytes
		// before handing them to the browser-side RSC reader
		function handle(entry: Chunk) {
			controller.enqueue(typeof entry === 'string' ? encoder.encode(entry) : entry)
		}

		// replay anything the page already wrote before this stream started.
		// That lets hydration read the early rows first
		for (const entry of flightData) handle(entry)

		// clear the array to release memory
		window.__FLIGHT_DATA.length = 0

		// later inline scripts call __FLIGHT_DATA.push(...). Forward each new row
		// into the open stream, then clear the array so old rows do not pile up
		// in memory
		flightData.push = (...entries: Chunk[]) => {
			const length = push(...entries)

			for (const entry of entries) handle(entry)

			// once React has the row, we no longer need to keep it in the array
			if (typeof window !== 'undefined' && window.__FLIGHT_DATA) {
				window.__FLIGHT_DATA.length = 0
			}

			// return the new length so the array behaves as expected
			return length
		}
	},
})

/**
 * Inject the payload into the outgoing HTML as small inline script pushes. This keeps
 * hydration on the first document load instead of doing a follow-up fetch. HTML still
 * streams through, but the closing body/html tags are held back until the payload
 * is written
 */
export function injectPayload(payload: ReadableStream<Uint8Array>, opts: Opts = {}) {
	const decoder = new TextDecoder()

	let payloadWrite: Promise<void> | undefined
	let buffered: Uint8Array[] = []
	let timeout: ReturnType<typeof setTimeout> | undefined

	function flush(controller: TransformStreamDefaultController<Uint8Array>) {
		for (const chunk of buffered) {
			let html = decoder.decode(chunk, { stream: true })

			// hold the final closing tags back so payload scripts land inside the document,
			// not after it
			if (html.endsWith(HTML_TRAIL)) html = html.slice(0, -HTML_TRAIL.length)

			// write the buffered html before the payload scripts, so they are guaranteed to be
			// parsed in the right place
			if (html) controller.enqueue(encoder.encode(html))
		}

		// flush any decoder state left over from split utf-8/html chunks
		let remaining = decoder.decode()

		// if the remaining buffered html ends with the closing tags, remove them so they
		// can be re-appended after the payload
		if (remaining.endsWith(HTML_TRAIL)) remaining = remaining.slice(0, -HTML_TRAIL.length)

		// if there is any html left after removing the closing tags, write it before the payload
		if (remaining) controller.enqueue(encoder.encode(remaining))

		buffered = []
		timeout = undefined
	}

	function start(controller: TransformStreamDefaultController<Uint8Array>) {
		// only start writing payload rows once, even if html keeps arriving
		payloadWrite ??= writePayload(payload, controller, opts.nonce)
		return payloadWrite
	}

	return new TransformStream<Uint8Array, Uint8Array>({
		transform(chunk, controller) {
			// collect html first so we can decide where the payload scripts belong
			buffered.push(chunk)

			if (timeout != null) return

			// html can arrive split in awkward places, so wait one tick before flushing.
			// That gives the next chunk a chance to join up and keeps scripts out of
			// half a tag
			timeout = setTimeout(() => {
				try {
					// once the buffered html is safe to write, start the payload writer too
					flush(controller)
				} catch (err) {
					controller.error(err)
					return
				}

				start(controller).catch(err => controller.error(err))
			}, 0)
		},
		async flush(controller) {
			if (timeout != null) {
				clearTimeout(timeout)
				flush(controller)
			}

			// finish every payload row before restoring the closing html tags
			await start(controller)
			controller.enqueue(encoder.encode(HTML_TRAIL))
		},
	})
}

/**
 * Turn each payload row into a tiny inline script that pushes into __FLIGHT_DATA.
 * Text rows stay as strings when possible, and binary rows fall back to base64.
 * The browser-side patched push then forwards those rows into the open stream
 */
async function writePayload(
	payload: ReadableStream<Uint8Array>,
	controller: TransformStreamDefaultController<Uint8Array>,
	nonce?: string,
) {
	const decoder = new TextDecoder('utf-8', { fatal: true })

	for await (const chunk of payload) {
		try {
			// most payload rows are plain text, so write the simplest script we can
			writePayloadScript(
				JSON.stringify(decoder.decode(chunk, { stream: true })),
				controller,
				nonce,
			)
		} catch {
			// most rows are text, but keep binary chunks intact when a payload
			// row cannot be decoded as utf-8
			const base64 = JSON.stringify(btoa(String.fromCodePoint(...chunk)))
			writePayloadScript(
				`Uint8Array.from(atob(${base64}), value => value.codePointAt(0))`,
				controller,
				nonce,
			)
		}
	}

	// flush any trailing decoder state after the stream ends
	const remaining = decoder.decode()

	if (remaining) {
		writePayloadScript(JSON.stringify(remaining), controller, nonce)
	}
}

/**
 * Wrap one payload row in a script tag that appends into the shared browser queue.
 * The script stays deliberately small: just push the row and let the patched push
 * do the rest
 */
function writePayloadScript(
	chunk: string,
	controller: TransformStreamDefaultController<Uint8Array>,
	nonce?: string,
) {
	// each script only does a normal __FLIGHT_DATA.push(...). The patched push
	// above forwards that row into the open stream. Escape the inline JS first
	// so HTML parsing cannot break the script body
	const script = `<script${nonce ? ` nonce="${nonce}"` : ''}>${escapeInlineScript(`(self.__FLIGHT_DATA||=[]).push(${chunk})`)}</script>`
	controller.enqueue(encoder.encode(script))
}

// Escape closing script tags and HTML comments inside inline JS
function escapeInlineScript(script: string) {
	return script.replace(/<!--/g, '<\\!--').replace(/<\/(script)/gi, '</\\$1')
}
