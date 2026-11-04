export function GET() {
	return Response.json({
		ok: true,
		route: '/api/health',
		group: '(app)',
	})
}
