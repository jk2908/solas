import { HTTP_EXCEPTION_DIGEST_PREFIX } from '../navigation/http-exception'
import { REDIRECT_DIGEST_PREFIX } from '../navigation/redirect'

const possibilities = [HTTP_EXCEPTION_DIGEST_PREFIX, REDIRECT_DIGEST_PREFIX]

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

	if (err instanceof Error) {
		if (err.name === 'AbortError') return true

		if (err.message === 'The render was aborted by the server without a reason') {
			return true
		}
	}

	return false
}
