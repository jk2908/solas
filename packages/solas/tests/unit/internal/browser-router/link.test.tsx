import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from 'vitest-browser-react'

vi.mock('../../../../src/internal/browser-router/use-router.js', () => ({
	useRouter: vi.fn(),
}))

const { useRouter } =
	await import('../../../../src/internal/browser-router/use-router.js')
const { Link } = await import('../../../../src/internal/browser-router/link.js')
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
})
