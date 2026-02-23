export const prerender = 'ppr'

export default function Layout({ children }: { children: React.ReactNode }) {
	return (
		<div>
			I am the another layout
			{children}
		</div>
	)
}
