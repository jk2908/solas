export function middleware(req: Request, next: () => Promise<Response>) {
	const url = new URL(req.url)

	if (url.pathname === '/blocked') {
		return new Response('blocked by middleware', { status: 403 })
	}

	if (url.pathname === '/cookies') {
		return next().then(res => {
			res.headers.append(
				'set-cookie',
				'drift_cookie_test=hello; Path=/; HttpOnly; SameSite=Lax',
			)
			return res
		})
	}

	return next()
}
