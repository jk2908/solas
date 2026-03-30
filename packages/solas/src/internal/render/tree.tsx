import { Suspense } from 'react'

import type { Resolver } from '../router/resolver'
import { HttpException, isHttpException } from '../navigation/http-exception'
import { HttpExceptionBoundary } from '../navigation/http-exception-boundary'
import DefaultErr from '../ui/defaults/error'

type Match = NonNullable<Resolver.EnhancedMatch>

/**
 * Render the resolved route tree for a matched page
 *
 * The shell is always `layouts[0]`. Every deeper segment is then wrapped from
 * the inside out in this order:
 *
 * 1. `Layout`
 * 2. `Suspense` with that segment's loading fallback
 * 3. `HttpExceptionBoundary` with that segment's status boundaries
 *
 * The shell level is applied last using the same outer wrapper order:
 * `HttpExceptionBoundary` -> `Suspense` -> `Shell`
 *
 * @example
 * ```tsx
 *   <HttpExceptionBoundary shell>
 *     <Suspense fallback={<ShellLoading />}>
 *       <Shell>
 *         <HttpExceptionBoundary segmentN>
 *           <Suspense fallback={<LoadingN />}>
 *             <LayoutN>
 *               ...
 *                 <HttpExceptionBoundary segment1>
 *                   <Suspense fallback={<Loading1 />}>
 *                     <Layout1>
 *                       <Page />
 *                     </Layout1>
 *                   </Suspense>
 *                 </HttpExceptionBoundary>
 *               ...
 *             </LayoutN>
 *           </Suspense>
 *         </HttpExceptionBoundary>
 *       </Shell>
 *     </Suspense>
 *   </HttpExceptionBoundary>
 * ```
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
	const {
		layouts,
		Page,
		'401s': unauthorized,
		'403s': forbidden,
		'404s': notFounds,
		'500s': serverErrors,
		loaders,
	} = ui

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
		401: unauthorized,
		403: forbidden,
		404: notFounds,
		500: serverErrors,
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
		const Unauthorized = unauthorized[idx]
		const Forbidden = forbidden[idx]
		const NotFound = notFounds[idx]
		const ServerError = serverErrors[idx]

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

		const errorBoundaries = {
			401: Unauthorized ? (
				<Unauthorized error={new HttpException(401, 'Unauthorized')} />
			) : null,
			403: Forbidden ? <Forbidden error={new HttpException(403, 'Forbidden')} /> : null,
			404: NotFound ? <NotFound error={new HttpException(404, 'Not found')} /> : null,
			500: ServerError ? (
				<ServerError error={new HttpException(500, 'Internal Server Error')} />
			) : null,
		}

		// wrap in error boundaries (if supplied for this segment's http errors)
		if (Object.values(errorBoundaries).some(c => c !== null)) {
			inner = (
				<HttpExceptionBoundary components={errorBoundaries}>
					{inner}
				</HttpExceptionBoundary>
			)
		}
	}

	// now wrap with shell structure: shell renders immediately,
	// inner streams inside Suspense
	const ShellLoading = loaders[0]
	const ShellUnauthorized = unauthorized[0]
	const ShellForbidden = forbidden[0]
	const ShellNotFound = notFounds[0]
	const ShellServerError = serverErrors[0]

	return (
		<HttpExceptionBoundary
			components={{
				401: ShellUnauthorized ? <ShellUnauthorized /> : null,
				403: ShellForbidden ? <ShellForbidden /> : null,
				404: ShellNotFound ? <ShellNotFound /> : null,
				500: ShellServerError ? <ShellServerError /> : null,
			}}>
			<Suspense fallback={ShellLoading ? <ShellLoading /> : null}>
				<Shell params={params}>{inner}</Shell>
			</Suspense>
		</HttpExceptionBoundary>
	)
}
