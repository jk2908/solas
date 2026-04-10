import { HTTP_EXCEPTION_DIGEST_PREFIX } from '../navigation/http-exception.js'
import { REDIRECT_DIGEST_PREFIX } from '../navigation/redirect.js'

const possibilities = [HTTP_EXCEPTION_DIGEST_PREFIX, REDIRECT_DIGEST_PREFIX]
const RENDER_ABORT_MESSAGE = 'The render was aborted by the server without a reason'

function isRenderAbortMessage(value: unknown) {
	return typeof value === 'string' && value.includes(RENDER_ABORT_MESSAGE)
}

export function getKnownDigest(err: unknown) {
	if (
		typeof err === 'object' &&
		err !== null &&
		'digest' in err &&
		typeof err.digest === 'string'
	) {
		for (const p of possibilities) {
			if (!err.digest.startsWith(p)) continue
			return err.digest
		}
	}

	return null
}

export function isKnownError(err: unknown) {
	if (getKnownDigest(err)) return true

	if (isRenderAbortMessage(err)) return true

	if (
		typeof err === 'object' &&
		err !== null &&
		'message' in err &&
		isRenderAbortMessage(err.message)
	) {
		return true
	}

	if (err instanceof Error) {
		if (err.name === 'AbortError') return true

		if (isRenderAbortMessage(err.message)) {
			return true
		}
	}

	return false
}
