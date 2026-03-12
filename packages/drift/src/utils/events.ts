import { Drift } from '../drift'

export namespace Events {
	const names = ['navigation', 'navigationerror'] as const

	/**
	 * Drift custom event class
	 * @template T - the type of the event detail
	 */
	export class DriftEvent<T> extends CustomEvent<T> {
		constructor(name: (typeof names)[number], detail?: T) {
			super(`${Drift.Config.NAME}${name}`, { detail })
		}
	}

	export function dispatch<T>(name: (typeof names)[number], detail: T) {
		window.dispatchEvent(new DriftEvent(name, detail))
	}
}
