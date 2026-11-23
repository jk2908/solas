import { describe, expect, it, vi, afterEach } from 'vitest'
import { render } from 'vitest-browser-react'

vi.mock('../../../../src/internal/browser-router/use-router.js', () => ({
	useRouter: vi.fn(),
}))

const { useRouter } =
	await import('../../../../src/internal/browser-router/use-router.js')
const { useSearchParams } =
	await import('../../../../src/internal/browser-router/use-search-params.js')

function renderWithSearch(search: string) {
	vi.mocked(useRouter).mockReturnValue({
		go: vi.fn(),
		invalidateCache: vi.fn(),
		prefetch: vi.fn(),
		refresh: vi.fn(),
		isNavigating: false,
		url: { pathname: '/', search, hash: '' },
		history: { entries: [], index: 0 },
	})

	window.history.replaceState({}, '', window.location.pathname + search)

	let captured: URLSearchParams | undefined

	function TestComponent() {
		const params = useSearchParams()
		captured = params
		return <div>ok</div>
	}

	return { captured: () => captured!, Component: TestComponent }
}

describe('useSearchParams', () => {
	afterEach(() => {
		window.history.replaceState({}, '', window.location.pathname)
	})

	it('returns URLSearchParams with current search', async () => {
		const { captured, Component } = renderWithSearch('?q=hello')
		await render(<Component />)
		expect(captured().get('q')).toBe('hello')
	})

	it('returns URLSearchParams with empty search', async () => {
		const { captured, Component } = renderWithSearch('')
		await render(<Component />)
		expect(captured().get('sessionId')).toBeNull()
		expect(captured().get('q')).toBeNull()
	})
})
