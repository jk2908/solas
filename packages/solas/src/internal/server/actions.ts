import { ReactFormState } from 'react-dom/client'

import {
	createTemporaryReferenceSet,
	decodeAction,
	decodeFormState,
	decodeReply,
	loadServerAction,
} from '@vitejs/plugin-rsc/rsc'

import { Solas } from '../../solas.js'
import { SolasRequest } from '../../types.js'
import { CsrfConfig, enforce } from './csrf.js'

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
export async function processActionRequest(req: SolasRequest, csrf: CsrfConfig = {}) {
	let returnValue: { ok: boolean; data: unknown } | undefined
	let formState: ReactFormState | undefined
	let temporaryReferences: unknown

	// enforce CSRF for all action requests
	enforce(req, csrf)

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
		const parsedFormData = req[Solas.Config.REQUEST_META_KEY]?.parsedFormData

		const formData = parsedFormData ?? (await req.formData())
		const decodedAction = await decodeAction(formData)
		const result = await decodedAction()
		formState = await decodeFormState(result, formData)
	}

	return { returnValue, formState, temporaryReferences }
}
