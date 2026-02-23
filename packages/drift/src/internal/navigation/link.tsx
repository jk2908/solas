'use client'

import { useRouter } from '../router/use-router'

type Props = {
	href: string
	preload?: 'intent' | 'hover' | 'none'
} & React.ComponentPropsWithRef<'a'>

/**
 * A link component that navigates to a given href
 * @param href - the href to navigate to
 * @param preload - when to preload the linked page, defaults to 'intent'
 * @param props - the props to pass to the link
 * @returns a link element that navigates to the given href
 */
export function Link({ href, preload = 'intent', ...props }: Props) {
	const { go, preload: preloader } = useRouter()

	return (
		<a
			{...props}
			href={href}
			onClick={e => {
				e.preventDefault()
				go(href)
			}}
			onFocus={() => {
				if (preload !== 'intent') return
				preloader(href)
			}}
			onTouchStart={() => {
				if (preload !== 'intent') return
				preloader(href)
			}}
			onMouseEnter={() => {
				if (preload === 'none') return
				preloader(href)
			}}
		/>
	)
}
