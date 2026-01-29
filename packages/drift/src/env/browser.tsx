import {
	StrictMode,
	Suspense,
	useCallback,
	useEffect,
	useState,
	useTransition,
} from 'react'
import { hydrateRoot } from 'react-dom/client'

import {
	createFromFetch,
	createFromReadableStream,
	createTemporaryReferenceSet,
	encodeReply,
	setServerCallback,
} from '@vitejs/plugin-rsc/browser'
import { rscStream } from 'rsc-html-stream/client'

import { ErrorBoundary } from '../ui/error-boundary'

import { Logger } from '../_shared/utils/logger'
import { RedirectBoundary } from '../navigation'
import { Head } from '../render/head'
import { RouterProvider } from '../router'
import type { RSCPayload } from './rsc'

/**
 * Browser RSC hydration entry point
 */
export async function browser() {
	const logger = new Logger()
	const payload = await createFromReadableStream<RSCPayload>(rscStream)

	let setPayload: (payload: RSCPayload) => void = () => {}

	function A() {
		const [p, setP] = useState<RSCPayload>(payload)
		const [isPending, startTransition] = useTransition()

		const setPayloadInTransition = useCallback((payload: RSCPayload) => {
			startTransition(() => {
				setP(payload)
			})
		}, [])

		useEffect(() => {
			// expose external setPayload - used inside
			// server callback to update payload after
			// action execution
			setPayload = setPayloadInTransition
		}, [setPayloadInTransition])

		return (
			<RedirectBoundary>
				<RouterProvider setPayload={setPayloadInTransition} isNavigating={isPending}>
					<ErrorBoundary
						fallback={null}
						onError={err => logger.error('[browser:metadata]', err)}>
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
					'x-rsc-action': id,
				},
			}),
			{ temporaryReferences },
		)

		setPayload(payload)

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
		setPayload(await createFromFetch<RSCPayload>(fetch(window.location.href)))
	})
}
