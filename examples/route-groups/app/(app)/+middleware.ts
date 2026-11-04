export function middleware(_req: Request, next: () => Promise<Response>) {
	return next().then(res => {
		res.headers.set('x-route-group', 'app')
		return res
	})
}
