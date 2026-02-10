export default function Layout({ children }: { children: React.ReactNode }) {
	return <div>I am the about layout {children}</div>
}

// all pages under /about will inherit ppr when global is 'declarative'
export const prerender = true