export function middleware(req: Request, next: (request?: Request) => Promise<Response>) {
	const dev = import.meta.env.DEV
	const nonce = crypto.randomUUID()

	const csp = dev
		? [
				"default-src 'self'",
				"script-src 'self' 'unsafe-inline' 'unsafe-eval'",
				"style-src 'self' 'unsafe-inline'",
				"connect-src 'self' ws: wss:",
			].join('; ')
		: [
				"default-src 'self'",
				`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
				`style-src 'self' 'nonce-${nonce}'`,
				"img-src 'self' data:",
				"object-src 'none'",
				"base-uri 'self'",
				"form-action 'self'",
				"frame-ancestors 'none'",
			].join('; ')

	const headers = new Headers(req.headers)

	if (!dev) headers.set('x-nonce', nonce)
	headers.set('Content-Security-Policy', csp)

	return next(new Request(req, { headers })).then(res => {
		res.headers.set('Content-Security-Policy', csp)
		return res
	})
}
