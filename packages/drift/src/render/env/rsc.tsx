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

import {
	HttpException,
	type Payload as HttpExceptionPayload,
	type HttpExceptionStatusCode,
} from '../../shared/http-exception'
import { Logger } from '../../shared/logger'
import { Metadata } from '../../shared/metadata'
import { Tree } from '../../shared/tree'

import { Matcher } from '../../server/matcher'

import DefaultErr from '../../ui/defaults/error'

import { getKnownDigest } from './utils'

export type RSCPayload = {
	returnValue?: { ok: boolean; data: unknown }
	formState?: ReactFormState
	root: React.ReactNode
	metadata?: Promise<Metadata.Item>
}

/**
 * RSC handler - returns a ReadableStream response for RSC requests
 * @param req - the incoming request
 * @param Shell - the app root (shell) component to render
 * @param manifest - the application manifest containing routes and metadata
 * @param importMap - the import map for route components and endpoints
 * @param baseMetadata - optional global metadata from config
 * @param returnValue - optional return value from an action
 * @param formState - optional React form state for hydration
 * @param temporaryReferences - optional temporary references for RSC
 * @returns a ReadableStream response for RSC requests
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
	const matcher = new Matcher(manifest, importMap)
	const logger = new Logger()
	const url = new URL(req.url)
	const pathname =
		url.pathname.endsWith('/') && url.pathname !== '/'
			? url.pathname.slice(0, -1)
			: url.pathname
	const match = matcher.enhance(matcher.reconcile(pathname, req.match, req.error))

	// if there's no match then no user supplied error boundary
	// has been found, and we should server render a default
	// error screen
	if (!match) {
		const error = req.error ?? new HttpException(404, 'Not found')
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
			stream: renderToReadableStream(rscPayload, {
				temporaryReferences,
				onError(err: unknown) {
					const digest = getKnownDigest(err)
					if (digest) return digest

					logger.error('[rsc]', err)
				},
			}),
			status: 404,
		}
	}

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
	const status = match.error instanceof HttpException ? match.error.status : 200

	try {
		const stream = renderToReadableStream(rscPayload, {
			temporaryReferences,
			onError(err: unknown) {
				const digest = getKnownDigest(err)
				if (digest) return digest

				logger.error('rsc', err)
			},
		})

		return { stream, status }
	} catch (err) {
		// shell failed to render - return minimal fallback
		logger.error('rsc shell', err)

		const title =
			err instanceof Error
				? 'status' in err
					? `${err.status} - ${err.message}`
					: `500 - ${err.message}`
				: '500 - Unknown server error'
		const message = err instanceof Error ? err.message : 'Unknown server error'

		return {
			stream: renderToReadableStream(
				{
					root: (
						<html lang="en">
							<head>
								<meta charSet="UTF-8" />
								<meta name="viewport" content="width=device-width, initial-scale=1.0" />
								<meta name="robots" content="noindex,nofollow" />

								<title>{title}</title>
							</head>

							<body>
								<h1>{title}</h1>
								<p>{message}</p>

								{err instanceof Error && err.stack && <pre>{err.stack}</pre>}
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
			status: 500,
		}
	}
}

export async function action(req: Request) {
	let returnValue: { ok: boolean; data: unknown } | undefined
	let formState: ReactFormState | undefined
	let temporaryReferences: unknown

	const id = req.headers.get('x-rsc-action-id')

	if (id) {
		// x-rsc-action header exists when action is
		// called via ReactClient.setServerCallback

		const body = req.headers.get('content-type')?.startsWith('multipart/form-data')
			? await req.formData()
			: await req.text()

		temporaryReferences = createTemporaryReferenceSet()

		const args = await decodeReply(body, {
			temporaryReferences,
		})
		const action = await loadServerAction(id)

		returnValue = await action.apply(null, args)
	} else {
		// otherwise server function is called via
		// <form action={...}> aka without js
		const formData = await req.formData()
		const decodedAction = await decodeAction(formData)
		const result = await decodedAction()
		formState = await decodeFormState(result, formData)
	}

	return { returnValue, formState, temporaryReferences }
}

const driftPayloadReducer = {
	Error: (v: unknown) => {
		if (!(v instanceof Error)) return false

		return [
			v.constructor.name,
			v.message,
			v.cause,
			v.stack,
			v instanceof HttpException ? v.status : undefined,
			v instanceof HttpException ? v.payload : undefined,
		]
	},
}

export const driftPayloadReviver = {
	Error: ([name, message, cause, stack, status, payload]: [
		string,
		string,
		unknown,
		string | undefined,
		HttpExceptionStatusCode | undefined,
		HttpExceptionPayload | undefined,
	]) => {
		if (name === 'HttpException' && status !== undefined) {
			const error = new HttpException(status, message, { payload, cause })
			if (stack) error.stack = stack

			return error
		} else {
			const error = new Error(message, { cause })
			if (stack) error.stack = stack

			return error
		}
	},
}
