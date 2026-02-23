import { Suspense } from 'react'

import { redirect } from '@jk2908/drift/navigation'

import { Blue } from '../blue'
import { Yellow } from '../yellow'

export const metadata = async () => ({
	title: 'Profile Page',
})

export default function Page() {
	redirect('/')

	return (
		<>
			I am the profile page
			<Suspense fallback={<div>Loading...</div>}>
				<Yellow />
			</Suspense>
			<Blue />
		</>
	)
}
