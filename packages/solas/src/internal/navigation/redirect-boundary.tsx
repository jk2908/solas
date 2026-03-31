'use client'

import { Component } from 'react'

import type { BoundaryError } from '../../types'

import { isRedirect, REDIRECT_DIGEST_PREFIX } from './redirect'

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

/**
 * A component that catches redirect errors in its child component tree and performs
 * a client-side redirect using a meta refresh tag
 */
export function RedirectBoundary({ children }: { children: React.ReactNode }) {
	return (
		<Boundary
			fallback={err => {
				if (!isRedirect(err)) throw err

				if ('digest' in err && typeof err.digest === 'string') {
					// rejoin after status so urls with colons (https://...) stay intact
					const [type, , ...parts] = err.digest.split(':')

					if (type === REDIRECT_DIGEST_PREFIX) {
						const url = parts.join(':')

						if (url) return <meta httpEquiv="refresh" content={`0;url=${url}`} />
					}
				}

				return null
			}}>
			{children}
		</Boundary>
	)
}
