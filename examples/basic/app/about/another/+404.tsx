import type { HttpException } from '@jk2908/drift/navigation'

export const metadata = ({ error }: { error?: HttpException }) => {
	const title =
		error && 'status' in error ? `${error.status} ${error.message}` : '404 Not found'

	return {
		title,
	}
}

export default function NotFound({ error }: { error?: HttpException }) {
	return <>I am the about/another 404 page {JSON.stringify(error, null, 2)}</>
}
