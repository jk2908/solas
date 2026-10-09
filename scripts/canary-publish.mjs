import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Stage a canary/experimental prerelease of @jk2908/solas from the local
 * working tree, then print the 2FA approval command (or run it when NPM_OTP is
 * set).
 *
 * The version is bumped to `<next-minor>-<tag>.<timestamp>` just for the stage
 * and restored afterwards, so the working tree stays clean. Staging mirrors the
 * CI workflow's stage-only trusted publisher: nothing goes live until a
 * maintainer approves the staged version with 2FA. `latest` is never touched.
 *
 *   bun run release:canary                 # stage -> @jk2908/solas@canary
 *   bun run release:canary experimental    # stage -> @jk2908/solas@experimental
 *   NPM_OTP=123456 bun run release:canary  # stage and approve in one go
 *
 * Requires an authenticated npm session (npm login). Staging needs no 2FA;
 * approving does.
 */
const tag = process.argv[2] ?? 'canary'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packageDir = path.join(root, 'packages', 'solas')
const packageJsonPath = path.join(packageDir, 'package.json')

const original = readFileSync(packageJsonPath, 'utf-8')
const pkg = JSON.parse(original)
const name = pkg.name
// Track the next minor so canaries sort below the eventual stable release and
// the base advances automatically when a stable version is committed.
const [major, minor] = pkg.version.split('-')[0].split('.').map(Number)
const version = `${major}.${minor + 1}.0-${tag}.${Date.now()}`

writeFileSync(packageJsonPath, `${JSON.stringify({ ...pkg, version }, null, '\t')}\n`)

try {
	console.log(`Staging ${name}@${version} with dist-tag "${tag}"`)
	execFileSync('npm', ['stage', 'publish', '--access', 'public', '--tag', tag], {
		cwd: packageDir,
		stdio: 'inherit',
	})
} finally {
	writeFileSync(packageJsonPath, original)
}

const stageId = findStageId(name, version)

if (!stageId) {
	console.log('\nStaged. Approve with 2FA:')
	console.log(`  npm stage list ${name}`)
	console.log('  npm stage approve <stage-id>')
	process.exit(0)
}

const otp = process.env.NPM_OTP

if (!otp) {
	console.log(`\nStaged as ${stageId}. Approve with 2FA:`)
	console.log(`  npm stage approve ${stageId}`)
	process.exit(0)
}

console.log(`\nApproving ${stageId}...`)
execFileSync('npm', ['stage', 'approve', stageId, `--otp=${otp}`], {
	cwd: packageDir,
	stdio: 'inherit',
})

/**
 * Look up the stage id of a staged version via `npm stage list --json`.
 */
function findStageId(packageName, stagedVersion) {
	try {
		const output = execFileSync('npm', ['stage', 'list', packageName, '--json'], {
			cwd: packageDir,
			encoding: 'utf-8',
			stdio: ['ignore', 'pipe', 'inherit'],
		})

		const items = JSON.parse(output)

		return items.find(item => item.version === stagedVersion)?.id
	} catch {
		return undefined
	}
}
