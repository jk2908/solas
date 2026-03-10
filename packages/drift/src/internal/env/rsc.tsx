import type { ReactFormState } from 'react-dom/client'

import {
	createTemporaryReferenceSet,
	decodeAction,
	decodeFormState,
	decodeReply,
	loadServerAction,
	renderToReadableStream,
} from '@vitejs/plugin-rsc/rsc'

import type { DriftRequest, ImportMap, Manifest } from '../../types'

import { Drift } from '../../drift'

import { Logger } from '../../utils/logger'
import { getKnownDigest, isKnownError } from './utils'

import { Metadata } from '../metadata'
import { HttpException, isHttpException } from '../navigation/http-exception'
import { Tree } from '../render/tree'
import { Resolver } from '../router/resolver'
import DefaultErr from '../ui/defaults/error'
import { RequestContext } from './request-context'

export type RSCPayload = {
	returnValue?: { ok: boolean; data: unknown }
	formState?: ReactFormState
	root: React.ReactNode
	metadata?: Promise<Metadata.Item>
}

/**
 * RSC handler - returns a ReadableStream response for RSC requests
 */
export async function rsc(
	req: DriftRequest,
	manifest: Manifest,
	importMap: ImportMap,
	baseMetadata?: Metadata.Item,
	returnValue?: { ok: boolean; data: unknown },
	formState?: ReactFormState,
	temporaryReferences?: unknown,
) {
	const resolver = new Resolver(manifest, importMap)
	const logger = new Logger()
	const prerender = req.headers.get('x-drift-prerender') === '1'
	const url = new URL(req.url)
	const pathname =
		url.pathname.endsWith('/') && url.pathname !== '/'
			? url.pathname.slice(0, -1)
			: url.pathname
	const match = resolver.enhance(
		resolver.reconcile(pathname, req[Drift.Config.$].match, req[Drift.Config.$].error),
	)

	// if there's no match then no user supplied error boundary
	// has been found, and we should server render a default
	// error screen
	if (!match) {
		const error = req[Drift.Config.$].error ?? new HttpException(404, 'Not found')
		const title = `${'status' in error ? `${error.status} -` : ''}${error.message}`

		const rscPayload: RSCPayload = {
			root: (
				<html lang="en">
					<head>
						<meta charSet="UTF-8" />
						<meta name="viewport" content="width=device-width, initial-scale=1.0" />
						<meta name="robots" content="noindex,nofollow" />

						<title>{title}</title>
					</head>

					<body>
						<DefaultErr error={error} />
					</body>
				</html>
			),
			returnValue,
			formState,
		}

		return {
			// this path is a safety fallback when a prerender request
			// hits an unmatched route. In build prerender we force
			// mode to 'full' so the 404/error shell resolves
			// immediately. In normal request-time rendering
			// we keep mode as null (obvi)
			stream: RequestContext.write(
				{
					req,
					prerender: prerender ? 'full' : null,
				},
				() =>
					renderToReadableStream(rscPayload, {
						temporaryReferences,
						onError(err: unknown) {
							if (err == null) return

							const digest = getKnownDigest(err)

							if (digest) return digest
							if (isKnownError(err)) return

							logger.error('[rsc]', err)
						},
					}),
			),
			status: 404,
			ppr: false,
		}
	}

	// check if this route is a candidate for ppr
	const ppr = match.prerender === 'ppr'
	const collection = new Metadata.Collection(baseMetadata)

	const metadata = match
		.metadata?.({ params: match.params, error: match.error })
		.then(m => {
			const values = m
				.filter(
					(
						result,
					): result is PromiseFulfilledResult<{
						task: Promise<Metadata.Item>
						priority: number
					}> => result.status === 'fulfilled',
				)
				.map(result => result.value)

			return collection.add(...values).run()
		})

	const rscPayload: RSCPayload = {
		root: (
			<>
				<Tree
					depth={match.__depth}
					params={match.params}
					error={match.error}
					ui={match.ui}
				/>
			</>
		),
		returnValue,
		formState,
		metadata,
	}

	// status code comes from route match error if any
	const status = isHttpException(match.error) ? match.error.status : 200

	try {
		// this is the main matched route render pass for page/layout
		// tree output. Mode is null for normal ssr, 'full' for full
		// prerender, and 'ppr' for ppr prerender. dynamic() only
		// suspends when mode is 'ppr'
		const stream = RequestContext.write(
			{
				req,
				prerender: prerender ? (ppr ? 'ppr' : 'full') : null,
			},
			() =>
				renderToReadableStream(rscPayload, {
					temporaryReferences,
					onError(err: unknown) {
						if (err == null) return

						const digest = getKnownDigest(err)

						if (digest) return digest
						if (isKnownError(err)) return

						logger.error('[rsc]', err)
					},
				}),
		)

		return { stream, status, ppr }
	} catch (err) {
		// shell failed to render - return minimal fallback
		logger.error('rsc shell', err)

		const title =
			err instanceof Error
				? 'status' in err
					? `${err.status} - ${err.message}`
					: `500 - ${err.message}`
				: '500 - Unknown server error'
		const error = new Error(err instanceof Error ? err.message : 'Unknown server error', {
			cause: err,
		})

		return {
			// this branch renders the minimal error shell after the
			// main tree throws. We keep the same mode as the
			// request so helpers see consistent state
			// prevents mode drift on error paths
			stream: RequestContext.write(
				{
					req,
					prerender: prerender ? 'full' : null,
				},
				() =>
					renderToReadableStream(
						{
							root: (
								<html lang="en">
									<head>
										<meta charSet="UTF-8" />
										<meta
											name="viewport"
											content="width=device-width, initial-scale=1.0"
										/>
										<meta name="robots" content="noindex,nofollow" />

										<title>{title}</title>
									</head>

									<body>
										<DefaultErr error={error} />
									</body>
								</html>
							),
							returnValue,
							formState,
						},
						{
							temporaryReferences,
						},
					),
			),
			status: 500,
			ppr: false,
		}
	}
}

export async function action(req: Request) {
	let returnValue: { ok: boolean; data: unknown } | undefined
	let formState: ReactFormState | undefined
	let temporaryReferences: unknown

	const id = req.headers.get('x-rsc-action-id')

	if (id) {
		// x-rsc-action-id header exists when action is
		// called via ReactClient.setServerCallback
		const body = req.headers.get('content-type')?.startsWith('multipart/form-data')
			? await req.formData()
			: await req.text()

		temporaryReferences = createTemporaryReferenceSet()
		const args = await decodeReply(body, {
			temporaryReferences,
		})

		const action = await loadServerAction(id)

		try {
			const data = await action.apply(null, args)
			returnValue = { ok: true, data }
		} catch (err) {
			returnValue = { ok: false, data: err }
		}
	} else {
		// otherwise server function is called via
		// <form action={...}>
		const formData = await req.formData()
		const decodedAction = await decodeAction(formData)
		const result = await decodedAction()
		formState = await decodeFormState(result, formData)
	}

	return { returnValue, formState, temporaryReferences }
}

export async function isAction(req: Request) {
	if (req.method !== 'POST') return false
	if (req.headers.has('x-rsc-action-id')) return true

	const contentType = req.headers.get('content-type') ?? ''
	if (!contentType.startsWith('multipart/form-data')) return false

	try {
		const formData = await req.clone().formData()

		for (const key of formData.keys()) {
			if (
				key === '$ACTION_KEY' ||
				key.startsWith('$ACTION_') ||
				key.startsWith('$ACTION_REF_')
			) {
				return true
			}
		}
	} catch {
		return false
	}

	return false
}
