import { Suspense, use } from 'react'
import type { ReactFormState } from 'react-dom/client'
import { resume as reactResume, renderToReadableStream } from 'react-dom/server.edge'
import { prerender as reactPrerender } from 'react-dom/static.edge'

import { createFromReadableStream } from '@vitejs/plugin-rsc/ssr'
import { injectRSCPayload } from 'rsc-html-stream/server'

import { Logger } from '../../utils/logger.js'

import type { RscPayload } from './rsc.js'
import { Solas } from '../../solas.js'
import { BrowserRouterProvider } from '../browser-router/router.js'
import { RedirectBoundary } from '../navigation/redirect-boundary.js'
import { Prerender } from '../prerender.js'
import { Head } from '../render/head.js'
import { ErrorBoundary } from '../ui/error-boundary.js'
import { getKnownDigest, isKnownError } from './utils.js'

type Opts = {
	formState?: ReactFormState
	nonce?: string
	ppr?: boolean
	route?: string
}

const logger = new Logger()

function A({ payloadPromise }: { payloadPromise: Promise<RscPayload> }) {
	const payload = use(payloadPromise)

	return (
		<RedirectBoundary>
			<BrowserRouterProvider url={payload.url}>
				<ErrorBoundary fallback={null}>
					<Suspense fallback={null}>
						<Head metadata={payload.metadata} />
					</Suspense>
				</ErrorBoundary>

				{payload.root}
			</BrowserRouterProvider>
		</RedirectBoundary>
	)
}

/**
 * SSR handler - returns a ReadableStream response for HTML requests
 */
async function ssr(rscStream: ReadableStream<Uint8Array>, opts: Opts = {}) {
	const { formState, nonce, ppr = false } = opts
	const [s1, s2] = rscStream.tee()
	const payloadPromise: Promise<RscPayload> = createFromReadableStream<RscPayload>(s1)

	const bootstrapScriptContent = await import.meta.viteRsc.loadBootstrapScriptContent(
		'index',
	)

	// ppr uses react prerender where prelude is the static shell
	// dynamic content is streamed via suspense
	// rsc payload is injected after
	if (ppr) {
		const { prelude } = await reactPrerender(<A payloadPromise={payloadPromise} />, {
			bootstrapScriptContent,
			onError(err) {
				const digest = getKnownDigest(err)

				if (digest) return digest
				if (isKnownError(err)) return

				logger.error('[ssr:ppr]', err)
			},
		})

		return prelude.pipeThrough(injectRSCPayload(s2, { nonce }))
	}

	const htmlStream = await renderToReadableStream(<A payloadPromise={payloadPromise} />, {
		bootstrapScriptContent,
		nonce,
		formState,
		onError(err) {
			const digest = getKnownDigest(err)

			if (digest) return digest
			if (isKnownError(err)) return

			logger.error('[ssr]', err)
		},
	})

	return htmlStream.pipeThrough(injectRSCPayload(s2, { nonce }))
}

/**
 * Build-time prerender artifact generation
 * @description for PPR routes this returns static prelude HTML + opaque postponed state
 */
async function prerender(rscStream: ReadableStream<Uint8Array>, opts: Opts = {}) {
	const { ppr = false, nonce, route } = opts

	if (!route) {
		const err = new Error('missing route in ssr.prerender() opts')
		logger.error('[ssr:prerender]', err)

		throw err
	}

	const [s1, s2] = rscStream.tee()
	const payloadPromise: Promise<RscPayload> = createFromReadableStream<RscPayload>(s1)

	const bootstrapScriptContent = await import.meta.viteRsc.loadBootstrapScriptContent(
		'index',
	)
	const schema = Solas.getVersion()

	if (ppr) {
		const controller = new AbortController()

		// abort on a macrotask so sync and microtask work still lands in prelude
		// unresolved work is captured as postponed state for resume
		setTimeout(() => {
			controller.abort(new Prerender.Runtime.Postponed())
		}, 0)

		const { prelude, postponed } = await reactPrerender(
			<A payloadPromise={payloadPromise} />,
			{
				bootstrapScriptContent,
				signal: controller.signal,
				onError(err) {
					if (Prerender.Runtime.isPostponed(err)) return

					const digest = getKnownDigest(err)

					if (digest) return digest
					if (isKnownError(err)) return

					logger.error('[ssr:prerender:ppr]', err)
				},
			},
		)

		// if prerender produced no postponed state, this route is effectively
		// fully prerenderable. Emit full HTML with embedded RSC payload
		if (postponed == null) {
			return {
				schema,
				route,
				createdAt: Date.now(),
				mode: 'full',
				html: await new Response(
					prelude.pipeThrough(injectRSCPayload(s2, { nonce })),
				).text(),
			}
		}

		return {
			schema,
			route,
			createdAt: Date.now(),
			mode: 'ppr',
			html: await new Response(prelude).text(),
			postponed,
		}
	}

	const stream = await renderToReadableStream(<A payloadPromise={payloadPromise} />, {
		bootstrapScriptContent,
		onError(err) {
			const digest = getKnownDigest(err)

			if (digest) return digest
			if (isKnownError(err)) return

			logger.error('[ssr:prerender:full]', err)
		},
	})

	await stream.allReady

	return {
		schema,
		route,
		createdAt: Date.now(),
		mode: 'full',
		html: await new Response(stream.pipeThrough(injectRSCPayload(s2, { nonce }))).text(),
	}
}

/**
 * Request-time resume for PPR routes
 */
async function resume(
	rscStream: ReadableStream<Uint8Array>,
	postponedState: unknown,
	opts: Pick<Opts, 'nonce'> & { injectPayload?: boolean } = {},
) {
	const { nonce, injectPayload = true } = opts

	const [s1, s2] = rscStream.tee()
	const payloadPromise: Promise<RscPayload> = createFromReadableStream<RscPayload>(s1)

	const htmlStream = await reactResume(
		<A payloadPromise={payloadPromise} />,
		postponedState as never,
		{
			nonce,
			onError(err) {
				const digest = getKnownDigest(err)

				if (digest) return digest
				if (isKnownError(err)) return

				logger.error('[ssr:resume]', err)
			},
		},
	)

	if (!injectPayload) return htmlStream

	return htmlStream.pipeThrough(injectRSCPayload(s2, { nonce }))
}

export type SSRModule = {
	prerender: typeof prerender
	resume: typeof resume
	ssr: typeof ssr
}

export { prerender, resume, ssr }
