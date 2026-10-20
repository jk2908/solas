import { describe, expect, it } from 'vitest'

import { create } from '../../../src/utils/context.js'

describe('Context', () => {
	describe('create', () => {
		it('creates a context with use and write methods', () => {
			const ctx = create<{ value: string }>('test')
			expect(typeof ctx.use).toBe('function')
			expect(typeof ctx.write).toBe('function')
		})
	})

	describe('use', () => {
		it('throws when no context is available', () => {
			const ctx = create<{ value: string }>('test')
			expect(() => ctx.use()).toThrow('No test context available')
		})

		it('returns the current context value', async () => {
			const ctx = create<{ value: string }>('test')
			const result = await ctx.write({ value: 'hello' }, () => ctx.use())
			expect(result.value).toBe('hello')
		})
	})

	describe('write', () => {
		it('provides context to the callback', async () => {
			const ctx = create<number>('counter')
			const result = await ctx.write(42, () => ctx.use())
			expect(result).toBe(42)
		})

		it('supports async callbacks', async () => {
			const ctx = create<string>('async')
			const result = await ctx.write('value', async () => {
				await new Promise(r => setTimeout(r, 10))
				return ctx.use()
			})
			expect(result).toBe('value')
		})

		it('isolates nested contexts', async () => {
			const ctx = create<number>('nested')
			const outer = await ctx.write(1, async () => {
				const inner = await ctx.write(2, () => ctx.use())
				return { outer: ctx.use(), inner }
			})
			expect(outer.outer).toBe(1)
			expect(outer.inner).toBe(2)
		})

		it('context is not available after write completes', async () => {
			const ctx = create<string>('scoped')
			await ctx.write('value', () => ctx.use())
			expect(() => ctx.use()).toThrow()
		})
	})
})
