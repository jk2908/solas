import { Drift } from '../drift'

import { HttpException } from '../internal/navigation/http-exception'

const LEVELS = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
	fatal: 4,
} as const

export type LogLevel = keyof typeof LEVELS

type LogEntry = {
	ts: number
	level: LogLevel
	message: string
	error?:
		| Error
		| HttpException
		| {
				message: string
				stack?: string
				cause?: unknown
		  }
}

/**
 * Log messages with different severity levels
 */
export class Logger {
	#level: LogLevel

	constructor(level: LogLevel = Logger.#getEnvLevel()) {
		this.#level = level
	}

	/**
	 * Check if a value is a valid log level
	 */
	static #isValidLevel(value: unknown): value is LogLevel {
		return typeof value === 'string' && value in LEVELS
	}

	/**
	 * Get the log level from environment variables, defaulting to 'info' if not set or invalid
	 */
	static #getEnvLevel() {
		if (typeof process === 'undefined') return 'info'

		const value = process.env.DRIFT_LOG_LEVEL ?? process.env.LOG_LEVEL
		if (!value) return 'info'

		const normalised = value.toLowerCase()

		return Logger.#isValidLevel(normalised) ? normalised : 'info'
	}

	/**
	 * Convert a value to an Error instance
	 */
	static toError(err: unknown) {
		return err instanceof Error ? err : new Error(String(err), { cause: err })
	}

	/**
	 * Stringify the error for logging
	 */
	static print(err: unknown) {
		if (err instanceof Error || err instanceof HttpException) {
			return err.message + (err.stack ? `\n${err.stack}` : '')
		}

		if (typeof err === 'object' && err !== null) {
			return JSON.stringify(err, null, 2)
		}

		return String(err)
	}

	set level(level: LogLevel) {
		this.#level = level
	}

	get level() {
		return this.#level
	}

	/**
	 * Log a message with a specific level
	 */
	log(level: LogLevel, message: string, error?: Error) {
		if (LEVELS[level] < LEVELS[this.#level]) return

		const entry: LogEntry = {
			ts: Date.now(),
			level,
			message,
		}

		if (level === 'error' || level === 'fatal') {
			entry.error = error ? Logger.toError(error) : new Error(message)
		}

		const line = `[${Drift.Config.NAME}] [${entry.ts}] [${level.toUpperCase()}] ${message}`
		const extra = entry.error ? `\n${Logger.print(entry.error)}` : ''

		if (level === 'warn') {
			console.warn(line, extra)
			return
		}

		if (level === 'error' || level === 'fatal') {
			console.error(line, extra)
			return
		}

		console.log(line, extra)
	}

	/**
	 * Log a debug message
	 */
	debug(...messages: string[]) {
		this.log('debug', messages.join(' '))
	}

	/**
	 * Log an info message
	 */
	info(...messages: string[]) {
		this.log('info', messages.join(' '))
	}

	/**
	 * Log a warning message
	 */
	warn(...messages: string[]) {
		this.log('warn', messages.join(' '))
	}

	/**
	 * Log an error message
	 */
	error(message: string, error?: unknown) {
		this.log('error', message, error === undefined ? undefined : Logger.toError(error))
	}

	/**
	 * Log a fatal error message
	 */
	fatal(message: string, error?: unknown) {
		this.log('fatal', message, error === undefined ? undefined : Logger.toError(error))
	}
}
