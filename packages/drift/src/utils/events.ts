import { Drift } from '../drift'

export namespace Events {
	/**
	 * Drift custom event class
	 * @template T - the type of the event detail
	 */
	export class DriftEvent<T> extends CustomEvent<T> {
		constructor(name: string, detail?: T) {
			super(`${Drift.Config.NAME}${name}`, { detail })
		}
	}

	export function dispatch<T>(name: string, detail: T) {
		window.dispatchEvent(new DriftEvent(name, detail))
	}
}
