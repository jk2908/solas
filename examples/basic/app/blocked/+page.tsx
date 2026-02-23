export const metadata = async () => ({
	title: 'Blocked Page',
})

export default function Page() {
	return <div>Blocked by middleware.</div>
}
