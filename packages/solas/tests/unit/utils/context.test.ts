import { describe, expect, it } from 'vitest'

import { create } from '../../../src/utils/context.js'

describe('Context', () => {
	describe('create', () => {
		it('creates a context with get and write methods', () => {
			const ctx = create<{ value: string }>('test')
			expect(typeof ctx.get).toBe('function')
			expect(typeof ctx.write).toBe('function')
		})
	})

	describe('use', () => {
		it('throws when no context is available', () => {
			const ctx = create<{ value: string }>('test')
			expect(() => ctx.get()).toThrow('No test context available')
		})

		it('returns the current context value', async () => {
			const ctx = create<{ value: string }>('test')
			const result = await ctx.write({ value: 'hello' }, () => ctx.get())
			expect(result.value).toBe('hello')
		})
	})

	describe('write', () => {
		it('provides context to the callback', async () => {
			const ctx = create<number>('counter')
			const result = await ctx.write(42, () => ctx.get())
			expect(result).toBe(42)
		})

		it('supports async callbacks', async () => {
			const ctx = create<string>('async')
			const result = await ctx.write('value', async () => {
				await new Promise(r => setTimeout(r, 10))
				return ctx.get()
			})
			expect(result).toBe('value')
		})

		it('isolates nested contexts', async () => {
			const ctx = create<number>('nested')
			const outer = await ctx.write(1, async () => {
				const inner = await ctx.write(2, () => ctx.get())
				return { outer: ctx.get(), inner }
			})
			expect(outer.outer).toBe(1)
			expect(outer.inner).toBe(2)
		})

		it('context is not available after write completes', async () => {
			const ctx = create<string>('scoped')
			await ctx.write('value', () => ctx.get())
			expect(() => ctx.get()).toThrow()
		})
	})
})
