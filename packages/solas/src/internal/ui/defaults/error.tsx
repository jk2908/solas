import type { HttpRouter } from '../../http-router/router.js'
import type { HttpExceptionLike } from '../../navigation/http-exception.js'

export default function Err({
	error,
}: {
	error: HttpExceptionLike
	params?: HttpRouter.Params
}) {
	const title = 'status' in error ? `${error.status} - ${error.message}` : error.message

	return (
		<>
			<meta name="robots" content="noindex,nofollow" />
			<title>{title}</title>

			<h1>{title}</h1>
			<p>{error.message}</p>

			{process.env.NODE_ENV === 'development' && error?.stack && <pre>{error.stack}</pre>}
		</>
	)
}
