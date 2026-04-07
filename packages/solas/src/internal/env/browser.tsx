import { StrictMode, Suspense, useCallback, useState, useTransition } from 'react'
import { hydrateRoot } from 'react-dom/client'

import {
	createFromFetch,
	createFromReadableStream,
	createTemporaryReferenceSet,
	encodeReply,
	setServerCallback,
} from '@vitejs/plugin-rsc/browser'
import { rscStream } from 'rsc-html-stream/client'

import type { RSCPayload } from './rsc.js'
import { RedirectBoundary } from '../navigation/redirect-boundary.js'
import { Head } from '../render/head.js'
import { RouterProvider } from '../router/router-provider.js'
import { ErrorBoundary } from '../ui/error-boundary.js'

/**
 * Browser RSC hydration entry point
 */
export async function browser() {
	const payload = await createFromReadableStream<RSCPayload>(rscStream, {
		unstable_allowPartialStream: true,
	})

	const payloadSetter: { current: (payload: RSCPayload) => void } = {
		current: () => {},
	}

	function A() {
		const [p, setP] = useState<RSCPayload>(payload)
		const [isPending, startTransition] = useTransition()

		const setPayloadInTransition = useCallback((payload: RSCPayload) => {
			startTransition(() => {
				setP(payload)
			})
		}, [])

		// make the latest payload updater available to action/hmr callbacks
		// immediately during render, without waiting for an effect to run
		payloadSetter.current = setPayloadInTransition

		return (
			<RedirectBoundary>
				<RouterProvider
					setPayload={setPayloadInTransition}
					isNavigating={isPending}
					url={p.url}>
					<ErrorBoundary fallback={null}>
						<Suspense fallback={null}>
							<Head metadata={p.metadata} />
						</Suspense>
					</ErrorBoundary>

					{p.root}
				</RouterProvider>
			</RedirectBoundary>
		)
	}

	setServerCallback(async (id, args) => {
		const url = new URL(window.location.href)
		const temporaryReferences = createTemporaryReferenceSet()
		const payload = await createFromFetch<RSCPayload>(
			fetch(url, {
				method: 'POST',
				body: await encodeReply(args, { temporaryReferences }),
				headers: {
					'x-rsc-action-id': id,
				},
			}),
			{ temporaryReferences },
		)

		payloadSetter.current(payload)

		const { ok, data } = payload.returnValue ?? {}
		if (!ok) throw data

		return data
	})

	hydrateRoot(
		document,
		<StrictMode>
			<A />
		</StrictMode>,
		{
			formState: payload.formState,
		},
	)

	import.meta.hot?.on?.('rsc:update', async () => {
		try {
			const p = await createFromFetch<RSCPayload>(
				fetch(window.location.href, { headers: { Accept: 'text/x-component' } }),
			)
			payloadSetter.current(p)
		} catch (err) {
			console.error('[hmr] failed to refresh rsc payload', err)
		}
	})
}
