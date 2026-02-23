import { Config } from '../config'

/**
 * Drift custom event class
 * @template T - the type of the event detail
 */
export class DriftEvent<T> extends CustomEvent<T> {
	constructor(name: string, detail?: T) {
		super(`${Config.NAME}${name}`, { detail })
	}
}
