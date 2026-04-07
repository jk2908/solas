import { ReactFormState } from 'react-dom/client'

import {
	createTemporaryReferenceSet,
	decodeAction,
	decodeFormState,
	decodeReply,
	loadServerAction,
} from '@vitejs/plugin-rsc/rsc'

import { SolasRequest } from '../../types.js'

import { Solas } from '../../solas.js'

import { HttpException } from '../navigation/http-exception.js'

/**
 * Check if a request is an action request and reuse parsed FormData
 * when multipart action detection already had to inspect the body
 */
export async function maybeAction(req: Request) {
	if (req.method !== 'POST') return { action: false, formData: null }
	if (req.headers.has('x-rsc-action-id')) return { action: true, formData: null }

	const contentType = req.headers.get('content-type') ?? ''

	if (!contentType.startsWith('multipart/form-data')) {
		return { action: false, formData: null }
	}

	try {
		const formData = await req.clone().formData()

		for (const key of formData.keys()) {
			if (
				key === '$ACTION_KEY' ||
				key.startsWith('$ACTION_') ||
				key.startsWith('$ACTION_REF_')
			) {
				return { action: true, formData }
			}
		}
	} catch {
		return { action: false, formData: null }
	}

	return { action: false, formData: null }
}

/**
 * Process an incoming action request, either from ReactClient.setServerCallback or a <form action={...}> submission
 * @returns an object containing either the return value of the action or the form state, depending on the type
 * of action request
 */
export async function processActionRequest(req: SolasRequest) {
	let returnValue: { ok: boolean; data: unknown } | undefined
	let formState: ReactFormState | undefined
	let temporaryReferences: unknown

	// reject cross-site action posts before any body decoding or action loading
	if (!isTrustedActionRequest(req)) {
		throw new HttpException(403, 'Cross-site action requests are forbidden')
	}

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

		// we might have already parsed FormData in the router for multipart action
		// detection should be attached to the SolasRequest, so we can reuse that
		// to avoid parsing twice
		const parsedFormData = req[Solas.Config.REQUEST_META]?.parsedFormData

		const formData = parsedFormData ?? (await req.formData())
		const decodedAction = await decodeAction(formData)
		const result = await decodedAction()
		formState = await decodeFormState(result, formData)
	}

	return { returnValue, formState, temporaryReferences }
}

/**
 * Reduce Origin and Referer headers to a comparable origin string
 */
function toOrigin(value: string | null) {
	if (!value) return null

	try {
		return new URL(value).origin
	} catch {
		return null
	}
}

/**
 * Check whether an action request came from the same origin as the target app
 */
export function isTrustedActionRequest(req: Request) {
	const requestOrigin = toOrigin(req.url)
	if (!requestOrigin) return false

	const origin = toOrigin(req.headers.get('origin'))
	if (origin) return origin === requestOrigin

	// some user agents omit Origin on same-origin form posts, so fall back to Referer
	const referer = toOrigin(req.headers.get('referer'))
	if (referer) return referer === requestOrigin

	return false
}
