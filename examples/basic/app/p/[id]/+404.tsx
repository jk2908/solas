import { Route, Solas } from '@jk2908/solas'
import type { HttpExceptionLike } from '@jk2908/solas/navigation'

export const metadata: Route.Metadata<Solas.Routes['/p/:id'], HttpExceptionLike> = ({
	error,
}) => {
	const title =
		error && 'status' in error ? `${error.status} ${error.message}` : '404 Not found'

	return {
		title,
	}
}

export default function NotFound({
	error,
}: Route.Props<Solas.Routes['/p/:id'], HttpExceptionLike>) {
	return <>No post found with error {JSON.stringify(error, null, 2)}</>
}
