export { Link } from './internal/browser-router/link.js'
export { Announcer } from './internal/render/announcer.js'
export { withBase } from './internal/browser-router/shared.js'
export {
	isBrowserRouterError,
	isRouteTargetError,
} from './internal/browser-router/errors.js'
export type {
	BrowserRouterError,
	BrowserRouterErrorCode,
	RouteTargetError,
	RouteTargetErrorCode,
} from './internal/browser-router/errors.js'
export { useRouter } from './internal/browser-router/use-router.js'
export { useSearchParams } from './internal/browser-router/use-search-params.js'
