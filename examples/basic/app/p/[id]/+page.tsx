import { Suspense } from 'react'

import { abort } from '@jk2908/solas/navigation'
import { dynamic } from '@jk2908/solas/server'

export const metadata = async ({ params }: { params?: { id: string } }) => {
	const post = allPosts.find(p => p.__mdsrc.slug === params?.id)

	return {
		title: post?.title ?? 'Post not found',
		meta: [
			{
				name: 'description',
				content: post?.excerpt,
			},
		],
	}
}

export default function Post({ params }: { params?: { id: string } }) {
	const post = allPosts.find(p => p.__mdsrc.slug === params?.id)

	if (!post) abort(404, 'Post not found')

	return (
		<>
			<div>Post {JSON.stringify(post)}</div>

			<Suspense fallback={<div>Loading...</div>}>
				<Timestamp slug={post.__mdsrc.slug} />
			</Suspense>
		</>
	)
}

async function Timestamp({ slug }: { slug: string }) {
	if (slug === 'post-2') {
		dynamic()
	}

	return <div>{Date.now()}</div>
}

export const params = () => allPosts.map(p => ({ id: p.__mdsrc.slug }))
export const prerender = 'ppr'

const allPosts = [
	{
		__mdsrc: {
			slug: 'post-1',
		},
		title: 'Post 1',
		excerpt: 'This is the excerpt for post 1',
	},
	{
		__mdsrc: {
			slug: 'post-2',
		},
		title: 'Post 2',
		excerpt: 'This is the excerpt for post 2',
	},
]
