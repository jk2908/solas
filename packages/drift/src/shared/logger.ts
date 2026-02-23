import { Config } from '../config'

import { HttpException } from './http-exception'

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
 * @param level - the severity level of the logger
 */
export class Logger {
	#level: LogLevel = 'info'

	constructor(level: LogLevel = 'info') {
		this.#level = level
	}

	set level(level: LogLevel) {
		this.#level = level
	}

	get level() {
		return this.#level
	}

	/**
	 * Log a message with a specific level
	 * @param level - the severity level of the logger
	 * @param message - the log message
	 * @param error - the error object (if any)
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

		console.log(
			`[${Config.NAME}] [${entry.ts}] [${level.toUpperCase()}] ${message}`,
			error ? `\n${error.stack}` : '',
		)
	}

	/**
	 * Log a debug message
	 * @param message - the debug message
	 */
	debug(...messages: string[]) {
		this.log('debug', messages.join(' '))
	}

	/**
	 * Log an info message
	 * @param message - the info message
	 */
	info(...messages: string[]) {
		this.log('info', messages.join(' '))
	}

	/**
	 * Log a warning message
	 * @param message - the warning message
	 */
	warn(...messages: string[]) {
		this.log('warn', messages.join(' '))
	}

	/**
	 * Log an error message
	 * @param message - the error message
	 * @param error - the error object
	 */
	error(message: string, error?: unknown) {
		this.log('error', message, Logger.toError(error))
	}

	/**
	 * Log a fatal error message
	 * @param message - the error message
	 * @param error - the error object
	 */
	fatal(message: string, error?: unknown) {
		this.log('fatal', message, Logger.toError(error))
	}

	/**
	 * Convert a value to an Error instance
	 * @param err - the value to convert
	 * @returns the Error instance
	 */
	static toError(err: unknown) {
		return err instanceof Error ? err : new Error(String(err), { cause: err })
	}

	/**
	 * Stringify the error for logging
	 * @param err - the error to print
	 * @returns the printed error
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
}
