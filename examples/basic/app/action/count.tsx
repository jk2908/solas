'use server'

let count = 0

export async function get() {
	return count
}

export async function update(formData: FormData) {
	count += Number(formData.get('change'))
}

export async function reset() {
	count = 0
}
