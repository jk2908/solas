import { Suspense } from 'react'

import type { Matcher } from '../server/matcher'

import DefaultErr from '../ui/defaults/error'
import { HttpExceptionBoundary } from '../ui/defaults/http-exception-boundary'

import { HttpException, isHttpException } from './http-exception'

type Match = NonNullable<Matcher.EnhancedMatch>

/**
 * Route tree renderer
 * @description stucture is as follows:
 * - shell (layouts[0]) renders immediately as the "skeleton"
 * - everything inside the shell is wrapped in Suspense so it can stream
 * - error boundaries wrap Suspense so they can catch streaming errors
 *
 * @param depth - current match depth
 * @param params - route params
 * @param error - error object, if any
 * @param ui - UI components for this route
 * @returns the rendered route tree
 *
 * @example
 *
 * <Shell>
 *   <Suspense>
 *     <ErrorBoundary>
 *       <Layout[1]>
 *         <Suspense>
 *           <ErrorBoundary>
 *             ...
 *               <Layout[n]>
 *                 <Suspense>
 *                   <ErrorBoundary>
 *                     <Page />
 *                   </ErrorBoundary>
 *                 </Suspense>
 *               </Layout[n]>
 *             ...
 *           </ErrorBoundary>
 *         </Suspense>
 *       </Layout[1]>
 *     </ErrorBoundary>
 *   </Suspense>
 * </Shell>
 *
 */
export function Tree({
	depth,
	params,
	error,
	ui,
}: {
	depth: Match['__depth']
	params: Match['params']
	error: Match['error']
	ui: Match['ui']
}) {
	const { layouts, Page, '404s': notFounds, loaders } = ui

	const Shell = layouts[0]
	if (!Shell) throw new Error('Shell layout is required in the route tree')

	// build the inner inner (everything after shell)
	let inner: React.ReactNode = null

	// map http status codes to exception components
	const httpExceptionMap: Record<
		number,
		(React.ComponentType<{
			children?: React.ReactNode
			error?: HttpException | undefined
		}> | null)[]
	> = {
		404: notFounds,
	}

	if (error && isHttpException(error)) {
		const Exception =
			httpExceptionMap[error.status].slice(0, depth + 1).findLast(e => e !== null) ??
			DefaultErr

		inner = (
			<>
				<meta name="robots" content="noindex,nofollow" />
				<Exception error={error} />
			</>
		)
	} else if (Page) {
		inner = <Page params={params} />
	}

	// wrap from innermost to layouts[1] (skip shell)
	for (let idx = layouts.length - 1; idx >= 1; idx--) {
		const Layout = layouts[idx]
		const Loading = loaders[idx]
		const NotFound = notFounds[idx]

		// wrap in layout
		if (Layout) {
			inner = (
				<Layout key={`l:${idx}`} params={params}>
					{inner}
				</Layout>
			)
		}

		// wrap in suspense (for this segment's loading state)
		if (Loading) {
			inner = <Suspense fallback={<Loading />}>{inner}</Suspense>
		}

		// wrap in not found boundary if it exists at this level.
		// Catches exceptions() thrown in render
		if (NotFound) {
			inner = (
				<HttpExceptionBoundary
					components={{ 404: <NotFound error={new HttpException(404, 'Not found')} /> }}>
					{inner}
				</HttpExceptionBoundary>
			)
		}
	}

	// now wrap with shell structure: shell renders immediately,
	// inner streams inside Suspense
	const ShellLoading = loaders[0]
	const ShellNotFound = notFounds[0]

	return (
		<HttpExceptionBoundary components={{ 404: ShellNotFound ? <ShellNotFound /> : null }}>
			<Suspense fallback={ShellLoading ? <ShellLoading /> : null}>
				<Shell params={params}>{inner}</Shell>
			</Suspense>
		</HttpExceptionBoundary>
	)
}
