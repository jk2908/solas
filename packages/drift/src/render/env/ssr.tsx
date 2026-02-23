import { Suspense, use } from 'react'
import type { ReactFormState } from 'react-dom/client'
import { renderToReadableStream } from 'react-dom/server.edge'

import { createFromReadableStream } from '@vitejs/plugin-rsc/ssr'
import { injectRSCPayload } from 'rsc-html-stream/server'

import { Logger } from '../../shared/logger'

import { RouterProvider } from '../../client/router'

import { ErrorBoundary } from '../../ui/components/error-boundary'
import { Metadata } from '../../ui/components/metadata'
import { RedirectBoundary } from '../../ui/defaults/redirect-boundary'

import type { RSCPayload } from './rsc'
import { getKnownDigest } from './utils'

/**
 * SSR handler - returns a ReadableStream response for HTML requests
 * @param rscStream - the RSC ReadableStream to render
 * @param formState - optional React form state for hydration
 * @param nonce - optional nonce for CSP
 * @returns a ReadableStream of the rendered HTML
 */
export async function ssr(
	rscStream: ReadableStream<Uint8Array>,
	formState?: ReactFormState,
	nonce?: string,
) {
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
							<Metadata metadata={payload.metadata} />
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

	return htmlStream.pipeThrough(
		injectRSCPayload(s2, {
			nonce,
		}),
	)
}
