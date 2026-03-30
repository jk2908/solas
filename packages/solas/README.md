# Solas

Solas is a React Server Components meta-framework powered by Vite.

## Install

```sh
npm install @jk2908/solas react react-dom react-server-dom-webpack vite
npm install -D @vitejs/plugin-react typescript vite-tsconfig-paths
```

## Use

Create a Vite config that registers Solas.

```ts
import { defineConfig } from 'vite'

import solas from '@jk2908/solas'
import react from '@vitejs/plugin-react'

export default defineConfig({
	plugins: [solas(), react()],
})
```

## Structure

Put your routes in `app/`.

```text
app/
	+layout.tsx
	+page.tsx
	+middleware.ts
	+loading.tsx
	+401.tsx
	+403.tsx
	+404.tsx
	+500.tsx
	about/
		+layout.tsx
		+page.tsx
	api/
		+endpoint.ts
	posts/
		[id]/
			+page.tsx
```

Use these filename conventions:

- `+layout.tsx`: shared layout for a route branch.
- `+page.tsx`: page component for a route.
- `+endpoint.ts`: request handler for non-page routes.
- `+middleware.ts`: middleware that runs for the current route branch and is inherited by child routes. Parent and child middleware stack together.
- `+loading.tsx`: loading fallback inherited by child routes.
- `+401.tsx`: boundary for unauthorised responses in the current route branch and its children.
- `+403.tsx`: boundary for forbidden responses in the current route branch and its children.
- `+404.tsx`: boundary for not found responses in the current route branch and its children.
- `+500.tsx`: boundary for server errors in the current route branch and its children.

Nested folders create nested routes. Dynamic segments use `[param]`, and catch-all segments use `[...param]`.

Status boundaries follow the same override pattern as layouts: a child route uses the nearest matching boundary file above it, and a more specific boundary replaces a parent one.

## Config

All Solas options are passed to `solas()` inside `defineConfig`.

### `url`

Use `url` to tell Solas what the public application origin is.

`url` is optional.

This happens inside `solas()` when the plugin builds its validated config object. Solas assigns `config.url` with this lookup order:

- `config.url`
- `VITE_APP_URL`
- `APP_URL`

Current behaviour:

- Solas reads that value during plugin configuration.
- Solas injects `APP_URL` and `VITE_APP_URL` into `import.meta.env`.
- The current Solas runtime does not otherwise require `config.url` for routing, build, or prerender to work.

In practice, that means you do not have to pass `url` unless your application code wants a canonical origin value, or you want to standardise that value in config rather than relying on environment variables.

If you do want to set it explicitly, this is the shape:

```ts
export default defineConfig(({ mode }) => ({
	plugins: [
		solas({
			url: mode === 'production' ? 'https://example.com' : 'http://localhost:8787',
		}),
	],
}))
```

If you prefer environment variables, set one of these instead:

```sh
APP_URL=https://example.com
```

```sh
VITE_APP_URL=https://example.com
```

### `port`

Use `port` to change the development server port.

Default: `8787`

```ts
export default defineConfig({
	plugins: [
		solas({
			port: 4000,
		}),
	],
})
```

### `precompress`

Use `precompress` to control whether Solas writes compressed build assets.

Default: `true`

```ts
export default defineConfig({
	plugins: [
		solas({
			precompress: false,
		}),
	],
})
```

### `prerender`

Use `prerender` to set the default prerender mode for the app. Valid values are `full`, `ppr`, and `false`.

Default: `false`

- `false`: do not prerender the route.
- `full`: render the full route to HTML at build time.
- `ppr`: prerender a static shell and defer dynamic regions to request time.

```ts
export default defineConfig({
	plugins: [
		solas({
			prerender: 'ppr',
		}),
	],
})
```

This value is only the default. Route files can override it with `export const prerender = ...`, and the nearest explicit export wins.

```ts
// vite.config.ts
export default defineConfig({
	plugins: [solas({ prerender: 'full' })],
})
```

```tsx
// app/about/+layout.tsx
export const prerender = 'ppr'
```

```tsx
// app/about/team/+page.tsx
export const prerender = false
```

In that example, the app default is `full`, the `about` layout overrides it to `ppr`, and the page overrides it again to `false`.

For dynamic routes, prerendering uses the params you export from the page:

```tsx
export const params = () => [{ id: 'post-1' }, { id: 'post-2' }]
export const prerender = 'full'
```

In `ppr` mode, Solas prerenders the shell and lets you defer parts of the tree to request time.

Use `dynamic()` inside a Suspense boundary to mark a subtree as request-time only:

```tsx
import { Suspense } from 'react'

import { dynamic } from '@jk2908/solas/server'

export const prerender = 'ppr'

export default function Page() {
	return (
		<Suspense fallback={<div>Loading...</div>}>
			<Ts />
		</Suspense>
	)
}

async function Ts() {
	dynamic()
	return <div>{Date.now()}</div>
}
```

During prerender, `dynamic()` suspends so the nearest Suspense fallback is written into the static shell. At request time, the deferred content resolves normally.

If you call `dynamic()` outside `ppr` mode, Solas does not defer that subtree. In `full` mode it logs a warning and the component still renders at build time.

`headers()`, `cookies()`, and `url()` also mark the current render path as dynamic, so they should be treated the same way when you are building a `ppr` shell.

### `metadata`

Use `metadata` to set default document metadata.

```ts
export default defineConfig({
	plugins: [
		solas({
			metadata: {
				title: '%s - Solas',
				meta: [
					{
						name: 'description',
						content: 'My Solas app',
					},
				],
			},
		}),
	],
})
```

This is also only the default. Route metadata is merged in order, so config metadata can be extended or overridden by the shell, layouts, page, and status boundaries. The later, more specific route metadata wins for titles and duplicate tags.

```tsx
// vite.config.ts
solas({
	metadata: {
		title: '%s - Solas',
	},
})

// app/+layout.tsx
export const metadata = {
	title: 'Docs',
}

// app/guides/+page.tsx
export const metadata = {
	title: 'Routing',
}
```

In that example, the final page title becomes `Routing - Solas`.

### `trailingSlash`

Use `trailingSlash` when you want generated routes to end with `/`.

Default: `false`

```ts
export default defineConfig({
	plugins: [
		solas({
			trailingSlash: true,
		}),
	],
})
```

### `logger.level`

Use `logger.level` to control internal Solas logging.

Default: `info`

Valid values are `debug`, `info`, `warn`, `error`, and `fatal`.

- `debug`: show everything
- `info`: the default
- `warn`: only warnings and errors
- `error`: only errors
- `fatal`: only fatal errors

This is mainly useful when debugging framework behaviour such as routing and prerendering. It is for Solas internals, not your app's general-purpose logging, and it does not control top-level CLI status output such as build and preview progress messages.

```ts
export default defineConfig({
	plugins: [
		solas({
			logger: {
				level: process.env.NODE_ENV === 'production' ? 'fatal' : 'info',
			},
		}),
	],
})
```

## Scripts

Add scripts to your app:

```json
{
	"scripts": {
		"dev": "solas dev",
		"build": "solas build",
		"preview": "solas preview"
	}
}
```

## Commands

- `solas dev` starts the development server.
- `solas build` creates a production build, prerenders configured routes, and writes compressed assets when enabled.
- `solas preview` serves the built app for local verification.
