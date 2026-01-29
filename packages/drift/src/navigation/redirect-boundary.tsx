'use client'

import { ErrorBoundary } from '../ui/error-boundary'

import { isRedirect, REDIRECT_DIGEST_PREFIX } from './redirect'

export function RedirectBoundary({ children }: { children: React.ReactNode }) {
	return (
		<ErrorBoundary
			fallback={err => {
				if (!isRedirect(err)) throw err

				if ('digest' in err && typeof err.digest === 'string') {
					const [type, ...rest] = err.digest.split(':')

					if (type === REDIRECT_DIGEST_PREFIX) {
						const [, url] = rest

						return <meta httpEquiv="refresh" content={`0;url=${url}`} />
					}
				}

				return null
			}}>
			{children}
		</ErrorBoundary>
	)
}
