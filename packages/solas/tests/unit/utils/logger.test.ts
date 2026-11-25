import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ErrorCode, SolasError } from '../../../src/utils/errors.js'
import { Logger, createLogger } from '../../../src/utils/logger.js'

describe('Logger', () => {
	let logSpy: ReturnType<typeof vi.spyOn>
	let warnSpy: ReturnType<typeof vi.spyOn>
	let errorSpy: ReturnType<typeof vi.spyOn>

	beforeEach(() => {
		logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
		errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
		Logger.defaultLevel = 'debug'
	})

	afterEach(() => {
		logSpy.mockRestore()
		warnSpy.mockRestore()
		errorSpy.mockRestore()
	})

	describe('defaultLevel', () => {
		it('defaults to info', () => {
			Logger.defaultLevel = 'info'
			expect(Logger.defaultLevel).toBe('info')
		})

		it('can be set', () => {
			Logger.defaultLevel = 'debug'
			expect(Logger.defaultLevel).toBe('debug')
		})
	})

	describe('instance level', () => {
		it('falls back to defaultLevel when not set', () => {
			const logger = new Logger()
			expect(logger.level).toBe('debug')
		})

		it('uses explicit level when set', () => {
			const logger = new Logger('error')
			expect(logger.level).toBe('error')
		})

		it('can be changed', () => {
			const logger = new Logger('debug')
			logger.level = 'warn'
			expect(logger.level).toBe('warn')
		})
	})

	describe('log filtering', () => {
		it('suppresses messages below current level', () => {
			const logger = new Logger('error')
			logger.debug('should not appear')
			logger.info('should not appear')
			logger.warn('should not appear')

			expect(logSpy).not.toHaveBeenCalled()
			expect(warnSpy).not.toHaveBeenCalled()
		})

		it('passes messages at or above current level', () => {
			const logger = new Logger('warn')
			logger.warn('visible')
			logger.error('visible')

			expect(warnSpy).toHaveBeenCalledOnce()
			expect(errorSpy).toHaveBeenCalledOnce()
		})
	})

	describe('output routing', () => {
		it('debug goes to console.log', () => {
			const logger = new Logger('debug')
			logger.debug('test')
			expect(logSpy).toHaveBeenCalledOnce()
		})

		it('info goes to console.log', () => {
			const logger = new Logger('info')
			logger.info('test')
			expect(logSpy).toHaveBeenCalledOnce()
		})

		it('warn goes to console.warn', () => {
			const logger = new Logger('warn')
			logger.warn('test')
			expect(warnSpy).toHaveBeenCalledOnce()
		})

		it('error goes to console.error', () => {
			const logger = new Logger('error')
			logger.error('test')
			expect(errorSpy).toHaveBeenCalledOnce()
		})

		it('fatal goes to console.error', () => {
			const logger = new Logger('fatal')
			logger.fatal('test')
			expect(errorSpy).toHaveBeenCalledOnce()
		})
	})

	describe('message formatting', () => {
		it('does not include a timestamp by default', () => {
			const logger = new Logger({ scope: 'build' })
			logger.info('hello')
			expect(logSpy.mock.calls[0][0]).not.toMatch(/\d{2}:\d{2}:\d{2}/)
		})

		it('includes the scope', () => {
			const logger = createLogger('build')
			logger.info('hello')
			expect(logSpy.mock.calls[0][0]).toContain('build')
		})

		it('creates a scoped logger with options', () => {
			const logger = createLogger('build', { timestamps: 'time' })
			logger.info('hello')
			expect(logSpy.mock.calls[0][0]).toContain('build')
			expect(logSpy.mock.calls[0][0]).toMatch(/\d{2}:\d{2}:\d{2}/)
		})

		it('includes a level symbol', () => {
			const logger = new Logger('debug')
			logger.info('hello')
			logger.success('done')
			logger.warn('careful')
			logger.error('failed')

			expect(logSpy.mock.calls[0][0]).toContain('›')
			expect(logSpy.mock.calls[1][0]).toContain('✓')
			expect(warnSpy.mock.calls[0][0]).toContain('!')
			expect(errorSpy.mock.calls[0][0]).toContain('✖')
		})

		it('includes message', () => {
			const logger = new Logger('info')
			logger.info('hello world')
			expect(logSpy.mock.calls[0][0]).toContain('hello world')
		})

		it('joins multiple messages with space', () => {
			const logger = new Logger('info')
			logger.info('hello', 'world')
			expect(logSpy.mock.calls[0][0]).toContain('hello world')
		})

		it('does not emit ANSI escapes when colour is unavailable', () => {
			const logger = new Logger('info')
			logger.info('hello')
			expect(logSpy.mock.calls[0][0]).not.toContain('\u001B[')
		})

		it('can include a short timestamp', () => {
			const logger = new Logger({ timestamps: 'time' })
			logger.info('hello')
			expect(logSpy.mock.calls[0][0]).toMatch(/\d{2}:\d{2}:\d{2}/)
		})

		it('can include an ISO timestamp', () => {
			const logger = new Logger({ timestamps: 'iso' })
			logger.info('hello')
			expect(logSpy.mock.calls[0][0]).toMatch(/\d{4}-\d{2}-\d{2}T/)
		})
	})

	describe('error handling', () => {
		it('attaches error for error-level logs', () => {
			const logger = new Logger('error')
			const err = new Error('boom')
			logger.error('failed', err)
			expect(errorSpy).toHaveBeenCalledOnce()
			expect(errorSpy.mock.calls[0][0]).toContain('boom')
		})

		it('attaches error for fatal-level logs', () => {
			const logger = new Logger('fatal')
			const err = new Error('fatal')
			logger.fatal('crash', err)
			expect(errorSpy).toHaveBeenCalledOnce()
			expect(errorSpy.mock.calls[0][0]).toContain('fatal')
		})

		it('includes the hint and code from a SolasError', () => {
			const logger = new Logger('error')
			const err = new SolasError(ErrorCode.RouteConflict, 'failed', {
				hint: 'try again',
			})
			logger.error(err)
			expect(errorSpy.mock.calls[0][0]).toContain('hint  try again')
			expect(errorSpy.mock.calls[0][0]).toContain('code  SOLAS_ROUTE_CONFLICT')
		})

		it('does not repeat the message when the error is the headline', () => {
			const logger = new Logger('error')
			const err = new SolasError(ErrorCode.RouteConflict, 'route conflict')
			logger.error(err)
			const output = String(errorSpy.mock.calls[0][0])
			expect(output.match(/route conflict/g)).toHaveLength(1)
		})
	})

	describe('toError', () => {
		it('returns Error instances as-is', () => {
			const err = new Error('test')
			expect(Logger.toError(err)).toBe(err)
		})

		it('wraps strings in Error', () => {
			const result = Logger.toError('string error')
			expect(result).toBeInstanceOf(Error)
			expect(result.message).toBe('string error')
		})

		it('wraps numbers in Error', () => {
			const result = Logger.toError(42)
			expect(result).toBeInstanceOf(Error)
			expect(result.message).toBe('42')
		})

		it('preserves cause', () => {
			const cause = { reason: 'test' }
			const result = Logger.toError(cause)
			expect(result.cause).toBe(cause)
		})
	})

	describe('print', () => {
		it('prints Error message and stack', () => {
			const err = new Error('test')
			const result = Logger.print(err)
			expect(result).toContain('test')
			expect(result).toContain('Error')
		})

		it('stringifies plain objects', () => {
			const result = Logger.print({ key: 'value' })
			expect(result).toContain('key')
			expect(result).toContain('value')
		})

		it('handles circular references gracefully', () => {
			const obj: Record<string, unknown> = {}
			obj.self = obj
			const result = Logger.print(obj)
			expect(typeof result).toBe('string')
		})

		it('stringifies primitives', () => {
			expect(Logger.print(42)).toBe('42')
			expect(Logger.print('hello')).toBe('hello')
			expect(Logger.print(null)).toBe('null')
		})
	})
})
