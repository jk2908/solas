import { HttpException } from '../internal/navigation/http-exception.js'
import { colour } from './colour.js'
import { formatError } from './errors.js'

const LEVELS = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
	fatal: 4,
} as const

export type LogLevel = keyof typeof LEVELS

type LogKind = LogLevel | 'success'

const SEVERITY: Record<LogKind, number> = {
	...LEVELS,
	success: LEVELS.info,
}

export type TimestampFormat = 'none' | 'time' | 'iso'

export type LoggerOptions = {
	level?: LogLevel
	/**
	 * Short source label rendered in its own column, for example `build`.
	 */
	scope?: string
	/**
	 * Timestamp style. CLI output defaults to none; server logs usually want
	 * `iso`.
	 */
	timestamps?: TimestampFormat
}

export type CreateLoggerOptions = Omit<LoggerOptions, 'scope'>

/**
 * Create a logger for one subsystem. Prefer one logger per module over one
 * logger per message category.
 */
export function createLogger(scope: string, options: CreateLoggerOptions = {}) {
	return new Logger({ ...options, scope })
}

const SYMBOL: Record<LogKind, string> = {
	debug: colour.gray('·'),
	info: colour.cyan('›'),
	success: colour.green('✓'),
	warn: colour.yellow('!'),
	error: colour.red('✖'),
	fatal: colour.bold(colour.red('✖')),
}

const SCOPE_WIDTH = 12

function formatTimestamp(ts: number, format: Exclude<TimestampFormat, 'none'>) {
	if (format === 'iso') return new Date(ts).toISOString()

	const date = new Date(ts)

	return [date.getHours(), date.getMinutes(), date.getSeconds()]
		.map(value => String(value).padStart(2, '0'))
		.join(':')
}

function indent(value: string) {
	return value
		.split('\n')
		.map(line => `  ${line}`)
		.join('\n')
}

/**
 * Log messages with different severity levels.
 *
 * CLI output is a stable set of columns so logs are easy to scan:
 *
 * `build        ✓  Built in 1.2s`
 * `prerender    !  Skipped /draft: status 404`
 *
 * Colour is applied only when the terminal supports it, so piped output stays
 * plain text. Timestamps are off by default; pass `timestamps: 'iso'` for
 * server logs.
 */
export class Logger {
	static #defaultLevel: LogLevel = 'info'

	#level?: LogLevel
	#scope?: string
	#timestamps: TimestampFormat = 'none'

	constructor(level?: LogLevel)
	constructor(options?: LoggerOptions)
	constructor(value?: LogLevel | LoggerOptions) {
		if (typeof value === 'string') {
			this.#level = value
			return
		}

		this.#level = value?.level
		this.#scope = value?.scope
		this.#timestamps = value?.timestamps ?? 'none'
	}

	static set defaultLevel(level: LogLevel) {
		Logger.#defaultLevel = level
	}

	static get defaultLevel() {
		return Logger.#defaultLevel
	}

	/**
	 * Convert a value to an Error instance.
	 */
	static toError(err: unknown) {
		return err instanceof Error ? err : new Error(String(err), { cause: err })
	}

	/**
	 * Stringify the error for logging.
	 */
	static print(err: unknown) {
		if (err instanceof Error || err instanceof HttpException) {
			return err.message + (err.stack ? `\n${err.stack}` : '')
		}

		// for plain objects, attempt to stringify with indentation
		// for readability
		if (typeof err === 'object' && err !== null) {
			try {
				return JSON.stringify(err, null, 2)
			} catch {
				// if stringify fails (e.g. circular reference), fall back
				// to basic string conversion
				return String(err)
			}
		}

		return String(err)
	}

	set level(level: LogLevel) {
		this.#level = level
	}

	get level() {
		return this.#level ?? Logger.#defaultLevel
	}

	/**
	 * Create a logger with the same level and timestamp style, and a new scope.
	 */
	child(scope: string) {
		return new Logger({
			level: this.#level,
			scope,
			timestamps: this.#timestamps,
		})
	}

	/**
	 * Log a message with a specific level.
	 */
	log(level: LogLevel, message: string, error?: Error, kind: LogKind = level) {
		if (SEVERITY[kind] < SEVERITY[this.level]) return

		const parts: string[] = []

		if (this.#timestamps !== 'none') {
			parts.push(colour.dim(formatTimestamp(Date.now(), this.#timestamps)))
		}

		if (this.#scope) {
			parts.push(colour.bold(this.#scope.padEnd(SCOPE_WIDTH)))
		}

		const head = parts.join('  ')
		const line = `${head ? `${head}  ` : ''}${SYMBOL[kind]}  ${message}`
		const body = this.#body(line, message, error)

		if (kind === 'warn') {
			console.warn(body)
			return
		}

		if (kind === 'error' || kind === 'fatal') {
			console.error(body)
			return
		}

		console.log(body)
	}

	#body(line: string, message: string, error?: Error) {
		if (!error) return line

		// when the error message is the headline, do not repeat it underneath
		const includeMessage = error.message !== message
		const detail = formatError(error, { includeMessage })

		return detail ? `${line}\n${indent(detail)}` : line
	}

	/**
	 * Log a debug message.
	 */
	debug(...messages: string[]) {
		this.log('debug', messages.join(' '))
	}

	/**
	 * Log an info message.
	 */
	info(...messages: string[]) {
		this.log('info', messages.join(' '))
	}

	/**
	 * Log a completed step.
	 */
	success(...messages: string[]) {
		this.log('info', messages.join(' '), undefined, 'success')
	}

	/**
	 * Log a warning message.
	 */
	warn(...messages: string[]) {
		this.log('warn', messages.join(' '))
	}

	/**
	 * Log an error message, or an error on its own.
	 */
	error(message: string, error?: unknown): void
	error(error: Error): void
	error(messageOrError: string | Error, error?: unknown) {
		if (messageOrError instanceof Error) {
			this.log('error', messageOrError.message, messageOrError)
			return
		}

		this.log(
			'error',
			messageOrError,
			error === undefined ? undefined : Logger.toError(error),
		)
	}

	/**
	 * Log a fatal error message, or a fatal error on its own.
	 */
	fatal(message: string, error?: unknown): void
	fatal(error: Error): void
	fatal(messageOrError: string | Error, error?: unknown) {
		if (messageOrError instanceof Error) {
			this.log('fatal', messageOrError.message, messageOrError)
			return
		}

		this.log(
			'fatal',
			messageOrError,
			error === undefined ? undefined : Logger.toError(error),
		)
	}
}
