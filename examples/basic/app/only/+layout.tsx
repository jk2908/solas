export const prerender = 'full'

export default function Layout({ children }: { children: React.ReactNode }) {
	return (
		<>
			I am a layout-only route segment
			{children}
		</>
	)
}
