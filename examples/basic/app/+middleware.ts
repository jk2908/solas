export function middleware(req: Request, next: () => Promise<Response>) {
	const url = new URL(req.url)

	if (url.pathname === '/blocked') {
		return new Response('blocked by middleware', { status: 403 })
	}

	return next()
}
