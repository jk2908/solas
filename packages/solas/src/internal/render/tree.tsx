import { Suspense } from 'react'

import type { Resolver } from '../resolver.js'
import { HttpExceptionBoundary } from '../navigation/http-exception-boundary.js'
import {
	HttpException,
	type HttpExceptionLike,
	isHttpException,
} from '../navigation/http-exception.js'
import DefaultErr from '../ui/defaults/error.js'

type Match = NonNullable<Resolver.EnhancedMatch>

const UNAUTHORISED_ERROR = new HttpException(401, 'Unauthorised')
const FORBIDDEN_ERROR = new HttpException(403, 'Forbidden')
const NOT_FOUND_ERROR = new HttpException(404, 'Not found')
const SERVER_ERROR = new HttpException(500, 'Internal Server Error')

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
	error?: HttpExceptionLike
	ui: Match['ui']
}) {
	const {
		layouts,
		Page,
		'401s': unauthorised,
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
		401: unauthorised,
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
		const Unauthorised = unauthorised[idx]
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
			401: Unauthorised ? <Unauthorised error={UNAUTHORISED_ERROR} /> : null,
			403: Forbidden ? <Forbidden error={FORBIDDEN_ERROR} /> : null,
			404: NotFound ? <NotFound error={NOT_FOUND_ERROR} /> : null,
			500: ServerError ? <ServerError error={SERVER_ERROR} /> : null,
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
	const ShellUnauthorised = unauthorised[0]
	const ShellForbidden = forbidden[0]
	const ShellNotFound = notFounds[0]
	const ShellServerError = serverErrors[0]

	const shell = <Shell params={params}>{inner}</Shell>

	return (
		<HttpExceptionBoundary
			components={{
				401: ShellUnauthorised ? <ShellUnauthorised error={UNAUTHORISED_ERROR} /> : null,
				403: ShellForbidden ? <ShellForbidden error={FORBIDDEN_ERROR} /> : null,
				404: ShellNotFound ? <ShellNotFound error={NOT_FOUND_ERROR} /> : null,
				500: ShellServerError ? <ShellServerError error={SERVER_ERROR} /> : null,
			}}>
			{ShellLoading ? <Suspense fallback={<ShellLoading />}>{shell}</Suspense> : shell}
		</HttpExceptionBoundary>
	)
}
