export const metadata = ({ params }: { params?: { catch: string[] } }) => {
	return {
		title: `Catch all route - ${params?.catch.join('/')}`,
	}
}

export default function Post({ params }: { params?: { catch: string[] } }) {
	return <>Post {JSON.stringify(params)}</>
}
