import { Suspense } from 'react'

import type { Metadata } from '../metadata.js'
import type { Resolver } from '../resolver.js'
import {
	ChildSlot,
	LayoutSlot,
	PageMarker,
	SegmentMetaMarker,
	SegmentSlot,
} from '../browser-router/segment-slot.js'
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
 * Render the resolved route tree for a matched page.
 *
 * The shell is always `layouts[0]`. Every deeper segment is then wrapped from
 * the inside out in this order:
 *
 * 1. `Layout`
 * 2. `Suspense` with that segment's loading fallback
 * 3. `HttpExceptionBoundary` with that segment's status boundaries
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
	layoutIds = [],
	shell = false,
	patch = false,
	layoutFilter,
	pageId,
	segmentHeads,
}: {
	depth: Match['__depth']
	params: Match['params']
	error?: HttpExceptionLike
	ui: Match['ui']
	layoutIds?: (string | null)[]
	shell?: boolean
	patch?: boolean
	layoutFilter?: string[]
	pageId?: string | null
	segmentHeads?: { id: string; metadata: Metadata.Item | Promise<Metadata.Item> }[]
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

	if (patch) {
		// one independent node per layout. The target subtree is supplied by
		// the layout slot that applies the node.
		const nodes: React.ReactNode[] = []

		for (const [idx, Layout] of layouts.entries()) {
			const id = layoutIds[idx]

			if (!Layout) continue
			if (layoutFilter && (id === null || !layoutFilter.includes(id))) continue

			const Loading = loaders[idx]
			const Unauthorised = unauthorised[idx]
			const Forbidden = forbidden[idx]
			const NotFound = notFounds[idx]
			const ServerError = serverErrors[idx]
			const errors = {
				401: Unauthorised ? <Unauthorised error={UNAUTHORISED_ERROR} /> : null,
				403: Forbidden ? <Forbidden error={FORBIDDEN_ERROR} /> : null,
				404: NotFound ? <NotFound error={NOT_FOUND_ERROR} /> : null,
				500: ServerError ? <ServerError error={SERVER_ERROR} /> : null,
			}
			const node = <Layout params={params}>{<ChildSlot />}</Layout>

			if (id) {
				const head = segmentHeads?.find(item => item.id === id)?.metadata

				nodes.push(
					<SegmentMetaMarker
						key={`m:${idx}`}
						id={id}
						pprMeta
						loading={Loading ? <Loading /> : undefined}
						errors={errors}
						head={head}
					/>,
				)
			}

			nodes.push(
				id ? (
					<LayoutSlot key={`l:${idx}`} id={id} pprLayout>
						{node}
					</LayoutSlot>
				) : (
					<Layout key={`l:${idx}`} params={params}>
						<ChildSlot />
					</Layout>
				),
			)
		}

		if (patch && Page) {
			const Loading = loaders[loaders.length - 1]
			const Unauthorised = unauthorised[unauthorised.length - 1]
			const Forbidden = forbidden[forbidden.length - 1]
			const NotFound = notFounds[notFounds.length - 1]
			const ServerError = serverErrors[serverErrors.length - 1]

			if (pageId) {
				const head = segmentHeads?.find(item => item.id === pageId)?.metadata

				nodes.push(
					<SegmentMetaMarker
						key="m:page"
						id={pageId}
						pprMeta
						loading={Loading ? <Loading /> : undefined}
						head={head}
						errors={{
							401: Unauthorised ? <Unauthorised error={UNAUTHORISED_ERROR} /> : null,
							403: Forbidden ? <Forbidden error={FORBIDDEN_ERROR} /> : null,
							404: NotFound ? <NotFound error={NOT_FOUND_ERROR} /> : null,
							500: ServerError ? <ServerError error={SERVER_ERROR} /> : null,
						}}
					/>,
				)
			}

			nodes.push(
				<PageMarker key="page" pprPage>
					<Page params={params} />
				</PageMarker>,
			)
		}

		return <>{nodes}</>
	}

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

	if (shell) {
		const Loading = loaders[loaders.length - 1] ?? loaders[0] ?? null

		inner = (
			<SegmentSlot id={pageId ?? undefined} fallback={Loading ? <Loading /> : null} />
		)
	} else if (error && isHttpException(error)) {
		const Exception =
			httpExceptionMap[error.status].slice(0, depth + 1).findLast(e => e !== null) ??
			DefaultErr

		inner = (
			<>
				<meta name="robots" content="noindex,nofollow" />
				<Exception error={error} params={params} />
			</>
		)
	} else if (Page) {
		inner = (
			<SegmentSlot id={pageId ?? undefined}>
				<Page params={params} />
			</SegmentSlot>
		)
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
			const id = layoutIds[idx]

			inner = id ? (
				<LayoutSlot key={`l:${idx}`} id={id} pprLayout child={inner}>
					<Layout params={params}>{inner}</Layout>
				</LayoutSlot>
			) : (
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

	const ShellLoading = loaders[0]
	const ShellUnauthorised = unauthorised[0]
	const ShellForbidden = forbidden[0]
	const ShellNotFound = notFounds[0]
	const ShellServerError = serverErrors[0]

	const shellId = layoutIds[0]
	const tree = shellId ? (
		<LayoutSlot id={shellId} pprLayout child={inner}>
			<Shell params={params}>{inner}</Shell>
		</LayoutSlot>
	) : (
		<Shell params={params}>{inner}</Shell>
	)

	return (
		<HttpExceptionBoundary
			components={{
				401: ShellUnauthorised ? <ShellUnauthorised error={UNAUTHORISED_ERROR} /> : null,
				403: ShellForbidden ? <ShellForbidden error={FORBIDDEN_ERROR} /> : null,
				404: ShellNotFound ? <ShellNotFound error={NOT_FOUND_ERROR} /> : null,
				500: ShellServerError ? <ShellServerError error={SERVER_ERROR} /> : null,
			}}>
			{ShellLoading ? <Suspense fallback={<ShellLoading />}>{tree}</Suspense> : tree}
		</HttpExceptionBoundary>
	)
}
