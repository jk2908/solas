export default function Post({ params }: { params?: { catch: string[] } }) {
	return <>Post {JSON.stringify(params)}</>
}
