'use client'

import { ErrorBoundary } from '../ui/error-boundary'

import {
	HTTP_EXCEPTION_DIGEST_PREFIX,
	type HttpExceptionStatusCode,
	isHttpException,
} from './http-exception'

type ComponentsMap = Record<HttpExceptionStatusCode, React.ReactElement | null>

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

						return (
							<>
								<meta name="robots" content="noindex,nofollow" />
								{components?.[status] ? components[status] : null}
							</>
						)
					}
				}

				return null
			}}>
			{children}
		</ErrorBoundary>
	)
}
