/**
 * Start the vite development server
 */
export async function dev() {
	const proc = Bun.spawn(['bunx', '--bun', 'vite', 'dev'], {
		cwd: process.cwd(),
		stdout: 'inherit',
		stderr: 'inherit',
		stdin: 'inherit',
		env: { ...process.env, NODE_ENV: 'development' },
	})

	await proc.exited
}
