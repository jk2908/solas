export const metadata = {
	title: 'Heavy route',
}

const groups = Array.from({ length: 120 }, (_, groupIndex) => ({
	id: `group-${groupIndex}`,
	title: `Group ${groupIndex + 1}`,
	items: Array.from({ length: 8 }, (_, itemIndex) => ({
		id: `group-${groupIndex}-item-${itemIndex}`,
		title: `Card ${groupIndex + 1}.${itemIndex + 1}`,
		copy: `This is a deliberately heavy route card for reveal timing ${groupIndex + 1}.${itemIndex + 1}.`,
		tags: ['alpha', 'beta', 'gamma'],
	})),
}))

export default function Page() {
	return (
		<div>
			<h1>Heavy route</h1>
			<p>
				This page exists to create a larger client commit when the route becomes
				visible.
			</p>

			{groups.map(group => (
				<section key={group.id}>
					<h2>{group.title}</h2>

					<div>
						{group.items.map(item => (
							<article key={item.id}>
								<h3>{item.title}</h3>
								<p>{item.copy}</p>
								<ul>
									{item.tags.map(tag => (
										<li key={`${item.id}-${tag}`}>{tag}</li>
									))}
								</ul>
							</article>
						))}
					</div>
				</section>
			))}
		</div>
	)
}