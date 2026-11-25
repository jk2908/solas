import { describe, it, expect } from 'vitest'
import { render } from 'vitest-browser-react'

import { HttpException } from '../../../../src/internal/navigation/http-exception.js'
import { Tree } from '../../../../src/internal/render/tree.js'

function Shell({ children }: { children?: React.ReactNode }) {
	return (
		<html lang="en">
			<body>
				<div data-testid="shell">{children}</div>
			</body>
		</html>
	)
}

function Layout({ children }: { children?: React.ReactNode }) {
	return <section data-testid="layout">{children}</section>
}

function InnerLayout({ children }: { children?: React.ReactNode }) {
	return <article data-testid="inner-layout">{children}</article>
}

function Page({ params }: { params?: Record<string, string> }) {
	return <main data-testid="page">{params?.id ?? 'no-id'}</main>
}

function NotFound() {
	return <div data-testid="not-found">404</div>
}

function ServerError() {
	return <div data-testid="server-error">500</div>
}

function Loading() {
	return <div data-testid="loading">Loading...</div>
}

function makeUI(overrides: Record<string, unknown> = {}) {
	return {
		layouts: [Shell],
		Page,
		'401s': [null],
		'403s': [null],
		'404s': [null],
		'500s': [null],
		loaders: [null],
		...overrides,
	}
}

describe('Tree', () => {
	it('renders shell with page', async () => {
		const screen = await render(<Tree depth={0} params={{}} ui={makeUI()} />)

		await expect.element(screen.getByTestId('shell')).toBeVisible()
		await expect.element(screen.getByTestId('page')).toBeVisible()
	})

	it('passes params to page', async () => {
		const screen = await render(<Tree depth={0} params={{ id: '42' }} ui={makeUI()} />)

		await expect.element(screen.getByTestId('page')).toHaveTextContent('42')
	})

	it('renders nested layouts', async () => {
		const screen = await render(
			<Tree depth={1} params={{}} ui={makeUI({ layouts: [Shell, Layout] })} />,
		)

		await expect.element(screen.getByTestId('shell')).toBeVisible()
		await expect.element(screen.getByTestId('layout')).toBeVisible()
		await expect.element(screen.getByTestId('page')).toBeVisible()
	})

	it('renders deeply nested layouts in correct order', async () => {
		const screen = await render(
			<Tree
				depth={2}
				params={{}}
				ui={makeUI({ layouts: [Shell, Layout, InnerLayout] })}
			/>,
		)

		await expect.element(screen.getByTestId('shell')).toBeVisible()
		await expect.element(screen.getByTestId('layout')).toBeVisible()
		await expect.element(screen.getByTestId('inner-layout')).toBeVisible()
		await expect.element(screen.getByTestId('page')).toBeVisible()
	})

	it('renders error component when HttpException error is provided', async () => {
		const error = new HttpException(404, 'Not found')
		const screen = await render(
			<Tree depth={0} params={{}} error={error} ui={makeUI({ '404s': [NotFound] })} />,
		)

		await expect.element(screen.getByTestId('not-found')).toBeVisible()
		await expect.element(screen.getByTestId('page')).not.toBeInTheDocument()
	})

	it('renders 500 error component', async () => {
		const error = new HttpException(500, 'Server error')
		const screen = await render(
			<Tree depth={0} params={{}} error={error} ui={makeUI({ '500s': [ServerError] })} />,
		)

		await expect.element(screen.getByTestId('server-error')).toBeVisible()
	})

	it('throws when shell layout is missing', async () => {
		await expect(
			render(<Tree depth={0} params={{}} ui={makeUI({ layouts: [] })} />),
		).rejects.toThrow('missing a shell layout')
	})

	it('renders shell without page when no page and no error', async () => {
		const screen = await render(
			<Tree depth={0} params={{}} ui={makeUI({ Page: null })} />,
		)

		await expect.element(screen.getByTestId('shell')).toBeInTheDocument()
		await expect.element(screen.getByTestId('page')).not.toBeInTheDocument()
	})

	it('wraps content in Suspense when loading component exists', async () => {
		const screen = await render(
			<Tree depth={0} params={{}} ui={makeUI({ loaders: [Loading] })} />,
		)

		await expect.element(screen.getByTestId('shell')).toBeVisible()
		await expect.element(screen.getByTestId('page')).toBeVisible()
	})
})
