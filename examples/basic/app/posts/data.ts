export type Post = {
	id: number
	title: string
	content: string
}

const POSTS: Post[] = [
	{
		id: 1,
		title: 'First Post',
		content: 'This is the content of the first post.',
	},
	{
		id: 2,
		title: 'Second Post',
		content: 'This is the content of the second post.',
	},
]

export function getPosts() {
	return POSTS
}
