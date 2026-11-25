/**
 * Minimal ANSI colour support for CLI output.
 *
 * Colour is disabled when stdout is not a TTY, when `NO_COLOR` is set, when
 * `FORCE_COLOR=0`, or when the terminal does not support colour. This keeps
 * piped and CI output clean.
 */
const ESC = '\u001B['

function colourEnabled() {
	if (typeof process === 'undefined') return false

	const env = process.env ?? {}

	if ('NO_COLOR' in env) return false
	if (env.FORCE_COLOR === '0' || env.FORCE_COLOR === 'false') return false
	if (env.FORCE_COLOR) return true
	if (env.TERM === 'dumb') return false

	return process.stdout?.isTTY === true
}

const enabled = colourEnabled()

function paint(open: number, close = 39) {
	return (value: string) => (enabled ? `${ESC}${open}m${value}${ESC}${close}m` : value)
}

export const colour = {
	enabled,
	bold: paint(1, 22),
	dim: paint(2, 22),
	red: paint(31),
	green: paint(32),
	yellow: paint(33),
	blue: paint(34),
	magenta: paint(35),
	cyan: paint(36),
	gray: paint(90),
}

const ANSI_PATTERN = new RegExp(`${ESC}\\[[0-9;]*m`, 'g')

/**
 * Remove ANSI escape sequences, for tests and non-TTY adapters.
 */
export function stripColour(value: string) {
	return value.replace(ANSI_PATTERN, '')
}
