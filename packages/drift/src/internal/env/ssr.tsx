import { Suspense, use } from 'react'
import type { ReactFormState } from 'react-dom/client'
import { renderToReadableStream } from 'react-dom/server.edge'
import { prerender } from 'react-dom/static.edge'

import { createFromReadableStream } from '@vitejs/plugin-rsc/ssr'
import { injectRSCPayload } from 'rsc-html-stream/server'

import { ErrorBoundary } from '../ui/error-boundary'

import { Logger } from '../../utils/logger'
import { RedirectBoundary } from '../navigation/redirect-boundary'
import { Head } from '../render/head'
import { RouterProvider } from '../router/router-context'
import type { RSCPayload } from './rsc'
import { getKnownDigest } from './utils'

type SSROptions = {
	formState?: ReactFormState
	nonce?: string
	ppr?: boolean
}

/**
 * SSR handler - returns a ReadableStream response for HTML requests
 * @param rscStream - the RSC ReadableStream to render
 * @param opts - SSR options including formState, nonce, and ppr mode
 * @returns a ReadableStream of the rendered HTML
 */
export async function ssr(rscStream: ReadableStream<Uint8Array>, opts: SSROptions = {}) {
	const { formState, nonce, ppr = false } = opts
	const logger = new Logger()
	const [s1, s2] = rscStream.tee()
	const payloadPromise: Promise<RSCPayload> = createFromReadableStream<RSCPayload>(s1)

	function A() {
		const payload = use(payloadPromise)

		return (
			<RedirectBoundary>
				<RouterProvider>
					<ErrorBoundary
						fallback={null}
						onError={err => logger.error('[ssr:metadata]', err)}>
						<Suspense fallback={null}>
							<Head metadata={payload.metadata} />
						</Suspense>
					</ErrorBoundary>

					{payload.root}
				</RouterProvider>
			</RedirectBoundary>
		)
	}

	const bootstrapScriptContent = await import.meta.viteRsc.loadBootstrapScriptContent(
		'index',
	)

	// ppr uses React's prerender api - prelude is the static shell,
	// dynamic content wrapped in Suspense streams
	// after via rsc payload
	if (ppr) {
		const { prelude } = await prerender(<A />, {
			bootstrapScriptContent,
			onError(err) {
				const digest = getKnownDigest(err)
				if (digest) return digest

				logger.error('[ssr:ppr]', err)
			},
		})

		return prelude.pipeThrough(injectRSCPayload(s2, { nonce }))
	}

	const htmlStream = await renderToReadableStream(<A />, {
		bootstrapScriptContent,
		nonce,
		formState,
		onError(err) {
			const digest = getKnownDigest(err)
			if (digest) return digest

			logger.error('[ssr]', err)
		},
	})

	return htmlStream.pipeThrough(injectRSCPayload(s2, { nonce }))
}
