import type { HttpException } from '../../shared/http-exception'

export default function Err({ error }: { error: HttpException | Error }) {
	const title = 'status' in error ? `${error.status} - ${error.message}` : error.message

	return (
		<>
			<meta name="robots" content="noindex,nofollow" />
			<title>{title}</title>

			<h1>{title}</h1>
			<p>{error.message}</p>

			{error?.stack && <pre>{error.stack}</pre>}
		</>
	)
}
