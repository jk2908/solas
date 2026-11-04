export default function Page({ params }: { params?: { slug: string } }) {
	return (
		<article>
			<h1>Blog post</h1>
			<p>
				This page is <code>app/(marketing)/blog/[slug]/+page.tsx</code> and renders at{' '}
				<code>/blog/{params?.slug}</code>.
			</p>
		</article>
	)
}
