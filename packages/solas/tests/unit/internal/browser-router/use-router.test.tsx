import { createContext } from 'react'

import { describe, it, expect, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import type { BrowserRouter } from '../../../../src/internal/browser-router/shared.js'

declare module '../../../../src/solas.js' {
	namespace Solas {
		interface Routes {
			'/somewhere': {}
			'/test': {}
			'/about': {}
		}
	}
}

vi.mock('../../../../src/internal/browser-router/router.js', () => ({
	BrowserRouterContext: createContext<BrowserRouter.Context>({
		go: async () => '',
		invalidate: () => {},
		prefetch: () => {},
		refresh: async () => '',
		isNavigating: false,
		url: { pathname: '/', search: '', hash: '' },
		history: { entries: [], index: 0 },
	}),
}))

const { BrowserRouterContext } =
	await import('../../../../src/internal/browser-router/router.js')
const { useRouter } =
	await import('../../../../src/internal/browser-router/use-router.js')

function createContextValue(
	overrides: Partial<BrowserRouter.Context> = {},
): BrowserRouter.Context {
	const base: BrowserRouter.Context = {
		go: vi.fn(),
		invalidate: vi.fn(),
		prefetch: vi.fn(),
		refresh: vi.fn(),
		isNavigating: false,
		url: { pathname: '/', search: '', hash: '' },
		history: { entries: [], index: 0 },
	}
	return Object.assign(base, overrides)
}

function TestComponent({
	onRouter,
}: {
	onRouter: (router: BrowserRouter.Context) => void
}) {
	const router = useRouter()
	onRouter(router)
	return <div>router test</div>
}

describe('useRouter', () => {
	it('returns the current router context', async () => {
		const onRouter = vi.fn()
		const contextValue = createContextValue({
			url: { pathname: '/test', search: '', hash: '' },
			history: { entries: [{ pathname: '/test', search: '', hash: '' }], index: 0 },
		})

		await render(
			<BrowserRouterContext value={contextValue}>
				<TestComponent onRouter={onRouter} />
			</BrowserRouterContext>,
		)

		expect(onRouter).toHaveBeenCalledWith(contextValue)
	})

	it('provides the go function from context', async () => {
		const go = vi.fn()
		const contextValue = createContextValue({ go })

		let capturedGo: BrowserRouter.Context['go']
		await render(
			<BrowserRouterContext value={contextValue}>
				<TestComponent
					onRouter={r => {
						capturedGo = r.go
					}}
				/>
			</BrowserRouterContext>,
		)

		capturedGo!('/somewhere')
		expect(go).toHaveBeenCalledWith('/somewhere')
	})

	it('provides invalidate from context', async () => {
		const invalidate = vi.fn()
		const contextValue = createContextValue({ invalidate })

		let capturedInvalidate: BrowserRouter.Context['invalidate']
		await render(
			<BrowserRouterContext value={contextValue}>
				<TestComponent
					onRouter={r => {
						capturedInvalidate = r.invalidate
					}}
				/>
			</BrowserRouterContext>,
		)

		capturedInvalidate!('/about')
		expect(invalidate).toHaveBeenCalledWith('/about')
	})

	it('provides the url from context', async () => {
		const contextValue = createContextValue({
			url: { pathname: '/about', search: '?q=1', hash: '#section' },
		})

		let capturedUrl: BrowserRouter.Context['url'] = { pathname: '', search: '', hash: '' }
		await render(
			<BrowserRouterContext value={contextValue}>
				<TestComponent
					onRouter={r => {
						capturedUrl = r.url
					}}
				/>
			</BrowserRouterContext>,
		)

		expect(capturedUrl.pathname).toBe('/about')
		expect(capturedUrl.search).toBe('?q=1')
		expect(capturedUrl.hash).toBe('#section')
	})
})
