'use client'

import { ErrorBoundary } from '../ui/error-boundary'
import {
	HTTP_EXCEPTION_DIGEST_PREFIX,
	type HttpException,
	isHttpException,
} from './http-exception'

type ComponentsMap = Partial<Record<HttpException.StatusCode, React.ReactElement | null>>

function isSupportedStatusCode(value: number): value is HttpException.StatusCode {
	return value === 401 || value === 403 || value === 404 || value === 500
}

export function HttpExceptionBoundary({
	components,
	children,
}: {
	components: ComponentsMap
	children: React.ReactNode
}) {
	return (
		<ErrorBoundary
			fallback={err => {
				if (!isHttpException(err)) throw err

				if ('digest' in err && typeof err.digest === 'string') {
					const [type, ...rest] = err.digest.split(':')

					if (type === HTTP_EXCEPTION_DIGEST_PREFIX) {
						const [code] = rest
						const status = Number(code)

						if (!isSupportedStatusCode(status)) throw err

						const component = components[status]
						// if no component is provided for this status code, re-throw
						// the error to be caught by a higher-level boundary
						// (e.g. the root boundary)
						if (!component) throw err

						return (
							<>
								<meta name="robots" content="noindex,nofollow" />
								{component}
							</>
						)
					}
				}

				throw err
			}}>
			{children}
		</ErrorBoundary>
	)
}
