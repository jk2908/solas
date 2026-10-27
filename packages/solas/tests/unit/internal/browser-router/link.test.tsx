import { createRef } from 'react'

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from 'vitest-browser-react'

vi.mock('../../../../src/internal/browser-router/use-router.js', () => ({
	useRouter: vi.fn(),
}))

const { useRouter } =
	await import('../../../../src/internal/browser-router/use-router.js')
const { Link } = await import('../../../../src/internal/browser-router/link.js')
const { PrefetchObserverProvider } =
	await import('../../../../src/internal/browser-router/prefetch-observer.js')
import type { BrowserRouter } from '../../../../src/internal/browser-router/shared.js'

// some Link tests click a real <a> without letting the router absorb the
// click (meta-click, right-click, or a consumer-prevented onClick). In those
// cases the browser performs a real navigation to the href, which reloads the
// vitest-browser iframe and drops the render under test. Intercepting the
// default here keeps the click event flowing to the component while
// preventing the iframe from navigating.
function blockNavigation() {
	const handler = (e: Event) => {
		if (e.target instanceof HTMLAnchorElement) e.preventDefault()
	}
	window.addEventListener('click', handler, { capture: true })
	return () => window.removeEventListener('click', handler, { capture: true })
}

declare module '../../../../src/solas.js' {
	namespace Solas {
		interface Routes {
			'/about': {}
			'/': {}
			'/test': {}
			'/internal': {}
			'/page': {}
			'/posts/:id': { params: { id: string } }
		}
	}
}

function mockRouter(overrides: Partial<BrowserRouter.Context> = {}) {
	vi.mocked(useRouter).mockReturnValue({
		go: vi.fn(),
		prefetch: vi.fn(),
		refresh: vi.fn(),
		isNavigating: false,
		url: { pathname: '/', search: '', hash: '' },
		history: { entries: [], index: 0 },
		...overrides,
	})
}

describe('Link', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockRouter()
	})

	it('renders an anchor with href', async () => {
		const screen = await render(<Link href="/about">About</Link>)
		const link = screen.getByRole('link', { name: 'About' })
		await expect.element(link).toBeVisible()
		await expect.element(link).toHaveAttribute('href', '/about')
	})

	it('renders children inside anchor', async () => {
		const screen = await render(<Link href="/">Home</Link>)
		await expect.element(screen.getByText('Home')).toBeVisible()
	})

	it('passes extra props to anchor', async () => {
		const screen = await render(
			<Link href="/test" className="my-link" id="test-link">
				link
			</Link>,
		)
		const link = screen.getByRole('link', { name: 'link' })
		await expect.element(link).toHaveAttribute('class', 'my-link')
		await expect.element(link).toHaveAttribute('id', 'test-link')
	})

	it('prevents default and calls go on click', async () => {
		const go = vi.fn().mockResolvedValue('/')
		mockRouter({ go })

		const screen = await render(<Link href="/internal">Click</Link>)
		await screen.getByRole('link', { name: 'Click' }).click()

		expect(go).toHaveBeenCalledWith('/internal', { params: undefined, query: undefined })
	})

	it('forwards the scroll option to go', async () => {
		const go = vi.fn().mockResolvedValue('/')
		mockRouter({ go })

		const screen = await render(
			<Link href="/internal" scroll="none">
				Keep
			</Link>,
		)
		await screen.getByRole('link', { name: 'Keep' }).click()

		expect(go).toHaveBeenCalledWith('/internal', {
			params: undefined,
			query: undefined,
			scroll: 'none',
		})
	})

	it('does not call go on meta-click', async () => {
		const go = vi.fn()
		mockRouter({ go })
		const unblock = blockNavigation()

		try {
			const screen = await render(<Link href="/page">MetaLink</Link>)
			await screen.getByRole('link', { name: 'MetaLink' }).click({ modifiers: ['Meta'] })

			expect(go).not.toHaveBeenCalled()
		} finally {
			unblock()
		}
	})

	it('does not intercept when onClick prevents default', async () => {
		const go = vi.fn()
		mockRouter({ go })
		const unblock = blockNavigation()

		try {
			const screen = await render(
				<Link href="/page" onClick={e => e.preventDefault()}>
					PreventLink
				</Link>,
			)
			await screen.getByRole('link', { name: 'PreventLink' }).click()

			expect(go).not.toHaveBeenCalled()
		} finally {
			unblock()
		}
	})

	it('renders with params and query', async () => {
		const screen = await render(
			<Link href="/posts/:id" params={{ id: '42' }} query={{ ref: 'home' }}>
				Post
			</Link>,
		)
		const link = screen.getByRole('link', { name: 'Post' })
		await expect.element(link).toHaveAttribute('href', '/posts/42?ref=home')
	})

	it('does not call go for right-click', async () => {
		const go = vi.fn()
		mockRouter({ go })
		const unblock = blockNavigation()

		try {
			const screen = await render(<Link href="/page">RightClickLink</Link>)
			await screen
				.getByRole('link', { name: 'RightClickLink' })
				.click({ button: 'right' })

			expect(go).not.toHaveBeenCalled()
		} finally {
			unblock()
		}
	})

	it('passes prefetch and rest props through', async () => {
		const screen = await render(
			<Link href="/test" prefetch="hover" target="_blank" rel="noopener">
				PrefLink
			</Link>,
		)
		const link = screen.getByRole('link', { name: 'PrefLink' })
		await expect.element(link).toHaveAttribute('target', '_blank')
		await expect.element(link).toHaveAttribute('rel', 'noopener')
	})

	it('treats prefetch false as none', async () => {
		const prefetch = vi.fn()
		mockRouter({ prefetch })

		const screen = await render(
			<Link href="/about" prefetch={false}>
				NoPrefetch
			</Link>,
		)
		const link = screen.getByRole('link', { name: 'NoPrefetch' })

		await link.hover()
		await link.click()
		await new Promise(resolve => setTimeout(resolve, 500))

		expect(prefetch).not.toHaveBeenCalled()
	})

	it('prefetches on click for intent', async () => {
		const prefetch = vi.fn()
		mockRouter({ prefetch })

		const screen = await render(
			<Link href="/about" prefetch="intent">
				IntentLink
			</Link>,
		)

		await screen.getByRole('link', { name: 'IntentLink' }).click()

		expect(prefetch).toHaveBeenCalledWith('/about')
	})

	it('prefetches after hovering for hover', async () => {
		const prefetch = vi.fn()
		mockRouter({ prefetch })

		const screen = await render(
			<Link href="/about" prefetch="hover">
				HoverLink
			</Link>,
		)

		await screen.getByRole('link', { name: 'HoverLink' }).hover()
		await new Promise(resolve => setTimeout(resolve, 500))

		expect(prefetch).toHaveBeenCalledWith('/about')
	})

	it('prefetches when a viewport link intersects', async () => {
		const instances: MockIntersectionObserver[] = []

		class MockIntersectionObserver {
			readonly root = null
			readonly rootMargin = ''
			readonly thresholds = []
			readonly observe = vi.fn()
			readonly disconnect = vi.fn()
			readonly takeRecords = vi.fn(() => [])
			readonly unobserve = vi.fn()

			constructor(
				readonly callback: IntersectionObserverCallback,
				readonly options?: IntersectionObserverInit,
			) {
				instances.push(this)
			}

			trigger() {
				this.callback(
					[
						{
							isIntersecting: true,
							target: document.querySelector('a[href="/about"]')!,
						} as IntersectionObserverEntry,
					],
					this as unknown as IntersectionObserver,
				)
			}
		}

		const original = globalThis.IntersectionObserver
		// @ts-expect-error test double
		globalThis.IntersectionObserver = MockIntersectionObserver

		try {
			const prefetch = vi.fn()
			mockRouter({ prefetch })

			await render(
				<PrefetchObserverProvider>
					<Link href="/about" prefetch="viewport">
						ViewportLink
					</Link>
				</PrefetchObserverProvider>,
			)

			const observer = instances.at(-1)
			expect(observer).toBeDefined()
			expect(observer?.observe).toHaveBeenCalled()

			observer?.trigger()

			expect(prefetch).toHaveBeenCalledWith('/about')
			expect(observer?.disconnect).toHaveBeenCalled()
		} finally {
			globalThis.IntersectionObserver = original
		}
	})

	it('uses hover on hover-capable devices for auto', async () => {
		const matchMedia = vi.spyOn(window, 'matchMedia').mockReturnValue({
			matches: true,
		} as MediaQueryList)

		try {
			const prefetch = vi.fn()
			mockRouter({ prefetch })

			const screen = await render(
				<Link href="/about" prefetch="auto">
					AutoHoverLink
				</Link>,
			)

			await screen.getByRole('link', { name: 'AutoHoverLink' }).hover()
			await new Promise(resolve => setTimeout(resolve, 500))

			expect(prefetch).toHaveBeenCalledWith('/about')
		} finally {
			matchMedia.mockRestore()
		}
	})

	it('uses viewport on devices without hover for auto', async () => {
		const matchMedia = vi.spyOn(window, 'matchMedia').mockReturnValue({
			matches: false,
		} as MediaQueryList)
		const instances: MockIntersectionObserver[] = []

		class MockIntersectionObserver {
			readonly root = null
			readonly rootMargin = ''
			readonly thresholds = []
			readonly observe = vi.fn()
			readonly disconnect = vi.fn()
			readonly takeRecords = vi.fn(() => [])
			readonly unobserve = vi.fn()

			constructor(readonly callback: IntersectionObserverCallback) {
				instances.push(this)
			}

			trigger() {
				this.callback(
					[
						{
							isIntersecting: true,
							target: document.querySelector('a[href="/about"]')!,
						} as IntersectionObserverEntry,
					],
					this as unknown as IntersectionObserver,
				)
			}
		}

		const original = globalThis.IntersectionObserver
		// @ts-expect-error test double
		globalThis.IntersectionObserver = MockIntersectionObserver

		try {
			const prefetch = vi.fn()
			mockRouter({ prefetch })

			await render(
				<PrefetchObserverProvider>
					<Link href="/about" prefetch="auto">
						AutoViewportLink
					</Link>
				</PrefetchObserverProvider>,
			)

			instances.at(-1)?.trigger()

			expect(prefetch).toHaveBeenCalledWith('/about')
		} finally {
			globalThis.IntersectionObserver = original
			matchMedia.mockRestore()
		}
	})

	it('shares one viewport observer across links in a provider', async () => {
		const instances: MockIntersectionObserver[] = []

		class MockIntersectionObserver {
			readonly root = null
			readonly rootMargin = ''
			readonly thresholds = []
			readonly observe = vi.fn()
			readonly disconnect = vi.fn()
			readonly takeRecords = vi.fn(() => [])
			readonly unobserve = vi.fn()

			constructor(readonly callback: IntersectionObserverCallback) {
				instances.push(this)
			}

			trigger(targets: Element[]) {
				this.callback(
					targets.map(target => ({ isIntersecting: true, target })) as [
						IntersectionObserverEntry,
					],
					this as unknown as IntersectionObserver,
				)
			}
		}

		const original = globalThis.IntersectionObserver
		// @ts-expect-error test double
		globalThis.IntersectionObserver = MockIntersectionObserver

		try {
			const prefetch = vi.fn()
			mockRouter({ prefetch })

			await render(
				<PrefetchObserverProvider>
					<Link href="/about" prefetch="viewport">
						First
					</Link>
					<Link href="/test" prefetch="viewport">
						Second
					</Link>
				</PrefetchObserverProvider>,
			)

			expect(instances).toHaveLength(1)

			const observer = instances[0]
			observer.trigger([
				document.querySelector('a[href="/about"]')!,
				document.querySelector('a[href="/test"]')!,
			])

			expect(prefetch).toHaveBeenCalledWith('/about')
			expect(prefetch).toHaveBeenCalledWith('/test')
		} finally {
			globalThis.IntersectionObserver = original
		}
	})

	it('forwards refs to the anchor', async () => {
		const ref = createRef<HTMLAnchorElement>()

		await render(
			<Link href="/about" ref={ref}>
				RefLink
			</Link>,
		)

		expect(ref.current).toBeInstanceOf(HTMLAnchorElement)
		expect(ref.current?.getAttribute('href')).toBe('/about')
	})

	it('does not prefetch the current route', async () => {
		const prefetch = vi.fn()
		mockRouter({ prefetch })
		const original = window.location.pathname + window.location.search

		window.history.replaceState({}, '', '/?tab=1')

		try {
			const screen = await render(
				<Link href="/" query={{ tab: '1' }} prefetch="hover">
					CurrentLink
				</Link>,
			)

			await screen.getByRole('link', { name: 'CurrentLink' }).hover()
			await new Promise(resolve => setTimeout(resolve, 500))

			expect(prefetch).not.toHaveBeenCalled()
		} finally {
			window.history.replaceState({}, '', original)
		}
	})

	it('prefetches the same path with a different query', async () => {
		const prefetch = vi.fn()
		mockRouter({ prefetch })
		const original = window.location.pathname + window.location.search

		window.history.replaceState({}, '', '/?tab=1')

		try {
			const screen = await render(
				<Link href="/" query={{ tab: '2' }} prefetch="hover">
					OtherQueryLink
				</Link>,
			)

			await screen.getByRole('link', { name: 'OtherQueryLink' }).hover()
			await new Promise(resolve => setTimeout(resolve, 500))

			expect(prefetch).toHaveBeenCalledWith('/?tab=2')
		} finally {
			window.history.replaceState({}, '', original)
		}
	})
})
