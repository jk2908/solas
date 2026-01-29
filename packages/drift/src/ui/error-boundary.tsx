'use client'

import { Component } from 'react'

type BoundaryError = Error & { digest?: string }

export type Props = {
	fallback:
		| ((error: BoundaryError, reset: () => void) => React.ReactNode)
		| React.ReactNode
	onError?: (error: BoundaryError) => void
	children: React.ReactNode
}

/**
 * A component that catches synchronous errors in its child component tree and displays a fallback UI
 * @param props - the props for the component
 * @param props.fallback - the fallback UI to display when an error occurs, can be a function, React node or component
 * @param props.onReset - a callback function to call when the error is reset
 * @param props.children - the child components to render
 * @returns Component
 */
export class ErrorBoundary extends Component<
	Props,
	{
		error: BoundaryError | null
	}
> {
	constructor(props: Props) {
		super(props)

		this.state = { error: null }
		this.reset = this.reset.bind(this)
	}

	static getDerivedStateFromError(error: Error) {
		return { error }
	}

	componentDidCatch(error: Error) {
		this.props.onError?.(error)
	}

	reset(onReset?: () => void) {
		if (this.state.error) this.setState({ error: null })
		onReset?.()
	}

	render() {
		const { error } = this.state
		if (!error) return this.props.children

		return typeof this.props.fallback === 'function'
			? this.props.fallback(error, this.reset)
			: this.props.fallback
	}
}
