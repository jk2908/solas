import {
	Activity,
	StrictMode,
	Suspense,
	useCallback,
	useEffect,
	useRef,
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

import { Solas } from '../../solas'

import type { RSCPayload } from './rsc'
import { RedirectBoundary } from '../navigation/redirect-boundary'
import { Head } from '../render/head'
import type { RouteEntry } from '../router/entry'
import { now, type NavigationTiming, type WarmTiming } from '../router/metrics'
import { RouterProvider } from '../router/router-provider'
import { ErrorBoundary } from '../ui/error-boundary'

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
		const [currentEntry, setCurrentEntry] = useState<RouteEntry>(() => {
			const path = window.location.pathname + window.location.search

			return {
				id: 0,
				path,
				requestedPath: path,
				payload,
			}
		})
		const [retainedEntry, setRetainedEntry] = useState<RouteEntry | null>(null)
		const [isPending, startTransition] = useTransition()
		const pendingNavigationTiming = useRef<NavigationTiming | null>(null)
		const pendingWarmTiming = useRef<WarmTiming | null>(null)

		const setPayloadInTransition = useCallback((payload: RSCPayload) => {
			startTransition(() => {
				setCurrentEntry(current => ({ ...current, payload }))
			})
		}, [])

		const setCurrentEntryInTransition = useCallback(
			(entry: RouteEntry) => {
				startTransition(() => {
					setRetainedEntry(currentEntry)
					setCurrentEntry(entry)
				})
			},
			[currentEntry],
		)

		const setRetainedEntryInTransition = useCallback((entry: RouteEntry | null) => {
			startTransition(() => {
				setRetainedEntry(entry)
			})
		}, [])

		// make the latest payload updater available to action/hmr callbacks
		// immediately during render, without waiting for an effect to run
		payloadSetter.current = setPayloadInTransition

		useEffect(() => {
			const timing = pendingNavigationTiming.current
			if (!timing) return

			pendingNavigationTiming.current = null
			const { startedAt, ...detail } = timing

			window.dispatchEvent(
				new CustomEvent(Solas.Events.names.NAVIGATION_TIMING, {
					detail: {
						...detail,
						commitMs: now() - startedAt,
					},
				}),
			)
		}, [currentEntry])

		useEffect(() => {
			if (!retainedEntry) return

			const timing = pendingWarmTiming.current
			if (!timing || timing.id !== retainedEntry.id) return

			pendingWarmTiming.current = null
			const { startedAt, ...detail } = timing

			window.dispatchEvent(
				new CustomEvent(Solas.Events.names.WARM_TIMING, {
					detail: {
						...detail,
						commitMs: now() - startedAt,
					},
				}),
			)
		}, [retainedEntry])

		return (
			<RedirectBoundary>
				<RouterProvider
					currentPath={currentEntry.path}
					isNavigating={isPending}
					retainedEntry={retainedEntry}
					setCurrentEntry={setCurrentEntryInTransition}
					setRetainedEntry={setRetainedEntryInTransition}
					onNavigationReady={timing => {
						pendingNavigationTiming.current = timing
					}}
					onWarmReady={timing => {
						pendingWarmTiming.current = timing
					}}>
					<ErrorBoundary fallback={null}>
						<Suspense fallback={null}>
							<Head metadata={currentEntry.payload.metadata} />
						</Suspense>
					</ErrorBoundary>

					{currentEntry.payload.root}

					{retainedEntry ? (
						<Activity mode="hidden" key={`${retainedEntry.path}:${retainedEntry.id}`}>
							{retainedEntry.payload.root}
						</Activity>
					) : null}
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
