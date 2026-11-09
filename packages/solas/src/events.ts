import * as Config from './config.js'

export const names = {
	NAVIGATION: `${Config.SLUG}navigation`,
	NAVIGATION_ERROR: `${Config.SLUG}navigationerror`,
	NAVIGATION_COMMITTED: `${Config.SLUG}navigationcommitted`,
} as const
