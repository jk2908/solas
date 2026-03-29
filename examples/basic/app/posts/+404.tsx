import type { HttpException } from '@jk2908/solas/navigation'

export const metadata = {
	title: 'Error Page',
}

export default function NotFound({ error }: { error?: HttpException }) {
	return <>I am the walrus 404 page {JSON.stringify(error, null, 2)}</>
}
