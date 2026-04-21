#!/usr/bin/env bun
import { build } from './cli/build.js'
import { dev } from './cli/dev.js'
import { preview } from './cli/preview.js'
import { Solas } from './solas.js'

// read the subcommand once and dispatch below
const [, , command] = process.argv

switch (command) {
	case 'build':
		await build()
		break
	case 'dev':
		await dev()
		break
	case 'preview':
		await preview()
		break
	default:
		console.log(`
			${Solas.Config.NAME} - cli

			Commands:
				build    Build for production (vite build + prerender + compress)
				dev      Start development server
				preview  Preview production build (serves prerendered HTML with SSR fallback)
		`)

		process.exit(command ? 1 : 0)
}
