'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

import { burn } from './lib/work.js'

function clamp(value: number, min: number, max: number) {
	if (!Number.isFinite(value)) return min

	return Math.min(max, Math.max(min, Math.trunc(value)))
}

export function ClientStress({
	initialRows,
	initialWork,
}: {
	initialRows: number
	initialWork: number
}) {
	const [rows, setRows] = useState(initialRows)
	const [work, setWork] = useState(initialWork)
	const [tick, setTick] = useState(0)

	const started = performance.now()
	const values = useMemo(
		() =>
			Array.from({ length: rows }, (_, index) => {
				const value = burn(index + tick + 1, work)

				return { id: `${index}:${value}`, index, value }
			}),
		[rows, work, tick],
	)
	const renderMs = performance.now() - started

	// publish the measurement after hydration so the server and client markup
	// match; the extra render reuses the memo above
	const latest = useRef(renderMs)
	latest.current = renderMs

	const [shownMs, setShownMs] = useState<number | null>(null)

	useEffect(() => {
		setShownMs(latest.current)
	}, [rows, work, tick])

	return (
		<div>
			<p>
				rows={rows} work={work} render=
				{shownMs === null ? '…' : `${shownMs.toFixed(1)}ms`}
			</p>

			<div>
				<button type="button" onClick={() => setTick(value => value + 1)}>
					Re-render
				</button>

				<button type="button" onClick={() => setTick(value => value + 10)}>
					Re-render ×10
				</button>

				<label>
					Rows
					<input
						type="number"
						min={1}
						max={50000}
						value={rows}
						onChange={event => setRows(clamp(Number(event.target.value), 1, 50000))}
					/>
				</label>

				<label>
					Work
					<input
						type="number"
						min={1}
						max={20000}
						value={work}
						onChange={event => setWork(clamp(Number(event.target.value), 1, 20000))}
					/>
				</label>
			</div>

			<ul>
				{values.map(item => (
					<li key={item.id}>
						{item.index}:{item.value.toString(36)}
					</li>
				))}
			</ul>
		</div>
	)
}
