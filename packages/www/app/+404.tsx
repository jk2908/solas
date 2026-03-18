export const metadata = ({ error }: { error?: Error }) => ({
	title: error ? error.message : 'Not Found',
})

export default function NotFound() {
	return (
		<div>
			<h1>wah wah wah</h1>
		</div>
	)
}
