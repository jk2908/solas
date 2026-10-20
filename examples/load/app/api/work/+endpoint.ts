import { burn, clampInt } from '../../lib/work.js'

export function GET(req: Request) {
	const { searchParams } = new URL(req.url)
	const work = clampInt(searchParams.get('work'), 100_000, 1, 2_000_000)

	const started = performance.now()
	const value = burn(1, work)
	const ms = performance.now() - started

	return Response.json({
		work,
		value,
		ms: Number(ms.toFixed(2)),
	})
}
