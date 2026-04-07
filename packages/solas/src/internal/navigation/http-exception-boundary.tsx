'use client'

import { Component } from 'react'

import type { BoundaryError } from '../../types.js'

import {
	HTTP_EXCEPTION_DIGEST_PREFIX,
	type HttpException,
	isHttpException,
} from './http-exception.js'

type ComponentsMap = Partial<Record<HttpException.StatusCode, React.ReactElement | null>>

function isSupportedStatusCode(value: number): value is HttpException.StatusCode {
	return value === 401 || value === 403 || value === 404 || value === 500
}

export type Props = {
	fallback: ((error: BoundaryError) => React.ReactNode) | React.ReactNode
	children: React.ReactNode
}

class Boundary extends Component<
	Props,
	{
		error: BoundaryError | null
	}
> {
	constructor(props: Props) {
		super(props)

		this.state = { error: null }
	}

	static getDerivedStateFromError(error: Error) {
		return { error }
	}

	render() {
		const { error } = this.state

		if (!error) return this.props.children

		return typeof this.props.fallback === 'function'
			? this.props.fallback(error)
			: this.props.fallback
	}
}

export function HttpExceptionBoundary({
	components,
	children,
}: {
	components: ComponentsMap
	children: React.ReactNode
}) {
	return (
		<Boundary
			fallback={err => {
				if (!isHttpException(err)) throw err

				if ('digest' in err && typeof err.digest === 'string') {
					// split with care, the message part may contain colons
					const [type, code] = err.digest.split(':')

					if (type === HTTP_EXCEPTION_DIGEST_PREFIX) {
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
		</Boundary>
	)
}
