# Solas

Solas is a minimal React meta-framework powered by Vite, created for experimenting with routing, streaming, and prerendering with React Server Components.

Solas is experimental and under active development, so expect rough edges.

## Install

Solas requires **Vite 8** (which uses Rolldown as the bundler).

```sh
npm install @jk2908/solas react react-dom react-server-dom-webpack vite@^8
npm install -D @vitejs/plugin-react@^6 typescript
```

Use Vite's built-in TypeScript path resolution (`resolve.tsconfigPaths: true`) rather than `vite-tsconfig-paths`, which is not compatible with Rolldown's handling of the `file://` runtime imports the RSC plugin emits.

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

Platform deployment is configured with the `adapter` option, which registers the platform's plugins alongside Solas's own instead of adding them to the plugins array:

```ts
import { defineConfig } from 'vite'

import solas from '@jk2908/solas'
import { cloudflare } from '@jk2908/solas/cloudflare/vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
	plugins: [solas({ adapter: cloudflare() }), react()],
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
- `+endpoint.ts`: request handler. Can be placed in any folder and responds to all HTTP methods for its route path.
- `+middleware.ts`: middleware that runs for the current route branch and is inherited by child routes. Parent and child middleware stack together.
- `+loading.tsx`: loading fallback inherited by child routes.
- `+401.tsx`: boundary for unauthorised responses in the current route branch and its children.
- `+403.tsx`: boundary for forbidden responses in the current route branch and its children.
- `+404.tsx`: boundary for not found responses in the current route branch and its children.
- `+500.tsx`: boundary for server errors in the current route branch and its children.

Nested folders create nested routes. Dynamic segments use `[param]`, and catch-all segments use `[...param]`.

Status boundaries follow the same override pattern as layouts: a child route uses the nearest matching boundary file above it, and a more specific boundary replaces a parent one.

If a route has both `+page.tsx` and `+endpoint.ts`, Solas selects the GET handler by `Accept` header:

- `Accept: text/html` or `text/x-component`: render `+page.tsx`
- other GET requests (for example `application/json`): run `+endpoint.ts` `GET`

Non-GET methods (`POST`, `PUT`, `PATCH`, `DELETE`) always run `+endpoint.ts`.

## Client Routing

Import client navigation helpers from `@jk2908/solas/router`.

```tsx
import { Link, useRouter } from '@jk2908/solas/router'
```

Solas generates route types for your app. `Link` and `router.go(...)` use those generated route types for autocomplete and type checking:

```tsx
<Link href="/posts" />
<Link href="/p/:id" params={{ id: 'post-1' }} />

await router.go('/posts')
await router.go('/p/:id', { params: { id: 'post-1' } })
```

That gives you:

- autocomplete for known route paths
- required params for dynamic routes like `/p/:id`
- rejected params for static routes that do not accept them
- typed query and navigation options on `router.go(...)`

If you already have a concrete path, you can pass that directly instead of using route params:

```tsx
;<Link href={`/p/${post.id}`} />

await router.go(`/p/${post.id}`)
```

In that form the path is already resolved, so `params` are not used. Typed `Link` and `router.go(...)` only allow `params` when you pass a route pattern like `/p/:id`.

If the target already contains a query string and you also pass `query`, Solas merges them. Existing query entries are kept unless you override the same key in `query`, and explicit `query` values win:

```tsx
<Link href={`/p/${post.id}?tab=summary`} query={{ draft: true, tab: 'full' }} />
```

That resolves to `/p/${post.id}?tab=full&draft=true`.

Use `Link` for same-origin app navigation. Prefetching is opt-in:

```tsx
<Link href="/posts">Posts</Link>
<Link href="/posts" prefetch="intent">Prefetch on focus or touch</Link>
<Link href="/posts" prefetch="hover">Prefetch on hover</Link>
<Link href="/p/:id" params={{ id: 'post-1' }}>Typed params</Link>
```

`prefetch="none"` is the default. Solas does not automatically prefetch routes unless you opt in with `Link` or call `router.prefetch(...)` yourself.

Use `useRouter()` inside client components for programmatic navigation, prefetching, and refreshing the current route:

```tsx
'use client'

import { useRouter } from '@jk2908/solas/router'

export function Controls() {
	const router = useRouter()

	return (
		<>
			<button type="button" onClick={() => router.go('/posts')}>
				Go to posts
			</button>

			<button type="button" onMouseEnter={() => router.prefetch('/posts')}>
				Prefetch posts
			</button>

			<button type="button" onClick={() => router.refresh()}>
				Refresh current route
			</button>
		</>
	)
}
```

`router.go(...)` and `router.refresh()` both return promises, so you can `await` either of them when you need to sequence work after navigation completes:

```tsx
const finalPath = await router.go('/posts')
```

```tsx
await router.refresh()
```

`router.refresh()` always refreshes the current browser location at the moment you call it. If you call it after `await router.go('/posts')`, it refreshes `/posts` (or the final redirected path).

`router.go(...)` accepts route params and query values using the same typed route rules as `Link`:

```tsx
await router.go('/p/:id', {
	params: { id: 'post-2' },
	query: { draft: true },
})
```

Those same generated route types can also be reused outside navigation helpers when you want route params to stay typed in page exports:

```tsx
import type { Route, Solas } from '@jk2908/solas'

export const metadata: Route.Metadata<Solas.Routes['/writing/:slug']> = ({ params }) => {
	const post = allPosts?.find(p => p.__mdsrc.slug === params?.slug)

	return {
		title: post?.title ?? 'Post not found',
	}
}

export const params: Route.StaticParams<Solas.Routes['/writing/:slug']> = () =>
	allPosts?.map(p => ({ slug: p.__mdsrc.slug })) ?? []
```

That keeps your route params aligned across links, imperative navigation, metadata, and static params.

`router.refresh()` clears the cached RSC response for the current path and fetches a fresh payload, so it is most useful for routes that render request-time data. `router.isNavigating` exposes pending client-side navigation state.

## Config

All Solas options are passed to `solas()` inside `defineConfig`.

### `url`

Use `url` to set the public origin for your app. It is optional.

Solas resolves the origin in this order:

- the `url` option passed to `solas()`
- `VITE_APP_URL`
- the Vite dev server `host` and `port` (defaults to `http://localhost:8787`)

The resolved origin is exposed to your app as `import.meta.env.VITE_APP_URL` and is used for build-time prerender requests and `sitemap` URLs. When `url` is set, it is also used as a trusted origin for CSRF.

You usually only need `url` in production, where the Vite dev server origin is meaningless. For example, to generate a `sitemap.xml` with real URLs:

```ts
export default defineConfig(({ mode }) => ({
	plugins: [
		solas({
			url: mode === 'production' ? 'https://example.com' : undefined,
			sitemap: true,
		}),
	],
}))
```

If you prefer an environment variable, set `VITE_APP_URL` instead:

```sh
VITE_APP_URL=https://example.com
```

Set the development port with Vite's `server.port`:

```ts
export default defineConfig({
	server: {
		port: 4000,
	},
	plugins: [solas(), react()],
})
```

### `precompress`

Use `precompress` to control whether Solas writes compressed browser-served build assets (like `.js`, `.css`, etc.).

Default: `false`

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
	await dynamic()
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

Use `trailingSlash` to set the app-wide URL policy.

Default: `never`

- `never`: `/about/` redirects to `/about`
- `always`: `/about` redirects to `/about/`
- `ignore`: both forms resolve without a canonical redirect

This is a global setting in `solas()`. Solas does not read `trailingSlash` from route files.

Prerendered output follows the same policy. `always` writes route HTML as `about/index.html`, while `never` and `ignore` write it as `about.html`.

```ts
export default defineConfig({
	plugins: [
		solas({
			trailingSlash: 'always',
		}),
	],
})
```

### `trustedOrigins`

Use `trustedOrigins` to allow specific origins to make cross-origin browser submissions to your app.

Default: `[]`

By default, only same-origin browser requests are allowed. Add a trusted origin when a third-party service needs to submit through the user's browser, such as a payment gateway or identity provider.

This setting controls which cross-origin browser sources are allowed for unsafe requests. See Security > CSRF for enforcement details.

Each value must be a complete origin including protocol:

```ts
export default defineConfig({
	plugins: [
		solas({
			trustedOrigins: ['https://payments.example.com', 'https://login.example.com'],
		}),
	],
})
```

Only add origins you completely trust.

### `sitemap`

Use `sitemap` to generate a `sitemap.xml` at build time.

Default: `false`

When enabled, Solas writes a sitemap containing all routes with deterministic URLs: static routes, prerendered routes, and dynamic routes resolved via `params`. The origin for each URL comes from the resolved origin (see Config > `url`).

```ts
export default defineConfig(({ mode }) => ({
	plugins: [
		solas({
			url: mode === 'production' ? 'https://example.com' : undefined,
			sitemap: true,
		}),
	],
}))
```

Routes with dynamic segments (`[id]`) or catch-all segments (`[...param]`) are only included if they export `params` and `prerender`.

To add routes that Solas cannot discover automatically (for example, catch-all routes backed by a CMS), pass an object with a `routes` function. The function receives the auto-discovered routes and returns the final list:

```ts
export default defineConfig({
	plugins: [
		solas({
			sitemap: {
				async routes(existing) {
					const posts = await getPosts()
					return [...existing, ...posts.map(p => `/blog/${p.slug}`)]
				},
			},
		}),
	],
})
```

The `routes` function can be async. The callback also lets you filter routes:

```ts
sitemap: {
	routes: (r) => r.filter(route => !route.startsWith('/admin')),
}
```

The sitemap is written to the build output directory as `sitemap.xml` after prerendering and before precompression.

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

## Cloudflare

Solas ships a Cloudflare adapter that runs the RSC server as a Worker and serves prerender artifacts and client assets through the Cloudflare assets binding.

It targets the **Cloudflare Vite plugin beta** and the **`cf` CLI** workflow, where the Worker is configured by `cloudflare.config.ts`. Install the beta plugin (and `cf` for deploys):

```sh
npm install -D @cloudflare/vite-plugin@beta cf
```

```ts
// vite.config.ts
import { defineConfig } from 'vite'

import solas from '@jk2908/solas'
import { cloudflare } from '@jk2908/solas/cloudflare/vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
	plugins: [solas({ prerender: 'full', adapter: cloudflare() }), react()],
})
```

The adapter is passed to `solas()` rather than added to the plugins array directly, so platform wiring stays in one place (the same shape as SvelteKit's `sveltekit({ adapter: adapter() })`).

Give the Worker a name and a compatibility date that enables `nodejs_compat`:

```ts
// cloudflare.config.ts
import { defineConfig, defineWorker } from 'cf/config'

export default defineConfig({
	worker: defineWorker({
		name: 'my-solas-app',
		compatibilityDate: '2026-10-02',
		compatibilityFlags: ['nodejs_compat'],
	}),
})
```

> `cloudflare.config.ts` is an open beta and must be loaded with Node 22.18+ (Bun is not supported), so the Cloudflare build and deploy commands run under Node. See the [`cf` documentation](https://developers.cloudflare.com/cf/) for the format and the `cf dev` / `cf build` / `cf deploy` commands.

### Bindings

Bindings are declared in `cloudflare.config.ts` and read with the standard Cloudflare global. The adapter does not manage them:

```ts
// cloudflare.config.ts
export default defineConfig({
	worker: defineWorker({
		name: 'my-solas-app',
		compatibilityDate: '2026-10-02',
		compatibilityFlags: ['nodejs_compat'],
		env: {
			MY_KV: bindings.kv({ id: '...' }),
		},
	}),
})
```

```tsx
// server component
import { env } from 'cloudflare:workers'

const value = await env.MY_KV.get('key')
```

The Cloudflare Vite plugin emulates bindings in `cf dev` and `vite preview`, so there is nothing extra to configure locally.

For types, the plugin writes `.cloudflare/types/index.d.ts` (bindings inferred from `cloudflare.config.ts`). Include it in `tsconfig.json` so `cloudflare:workers`'s `env` is typed:

```jsonc
{
	"include": ["app", ".solas/*", ".cloudflare/types"],
}
```

The adapter:

- configures `@cloudflare/vite-plugin` to build the `rsc` environment as the Worker, and injects the generated entrypoint, the `ASSETS` binding, and `htmlHandling: none` / `notFoundHandling: none` into the Worker config
- generates the Worker entry (a virtual module) that delegates to the typed `createWorker` helper
- points Solas's prerender step at the Cloudflare Worker bundle
- copies `dist/static` (full prerenders) and `dist/.solas` (runtime manifest + ppr artifacts) into the asset output under `/_solas-artifacts`

`htmlHandling: none` stops the asset layer serving a prerendered document at its route path. That matters because the asset layer ignores `Accept`, so an RSC navigation (`Accept: text/x-component`) to a fully-prerendered route would otherwise receive HTML and fail to parse. Routing documents through the Worker lets Solas serve the prerender for `text/html` and render RSC otherwise, while non-HTML assets (JS, CSS, fonts, images) are still served straight from the asset layer.

Because workers have no filesystem, the Worker reads its own output through the `ASSETS` binding. Reads use logical namespaces rather than filesystem paths: `client` maps onto asset-root URLs, and `static` (prerenders) and `artifact` (manifest, ppr) map onto the artifact prefix. During the build-time prerender pass the Worker is invoked without bindings, so the Node asset store is used and reads/writes artifacts on disk.

`cloudflare()` forwards its `cloudflare` option to `@cloudflare/vite-plugin`. To build a Worker manually, `createWorker` composes the entry behaviour, and `createCloudflareAssets` builds the store directly:

```ts
import { createCloudflareAssets } from '@jk2908/solas/cloudflare'

const assets = createCloudflareAssets(env)
```

## Node

`vite dev` and `vite preview` already run the built handler in Node (via `@vitejs/plugin-rsc`'s default server handler), so nothing extra is needed locally. For a production Node server, use `@jk2908/solas/node`:

```ts
// server.ts
import { serve } from '@jk2908/solas/node'

await serve()
```

```json
{
	"scripts": {
		"build": "vite build",
		"start": "node server.ts"
	}
}
```

`serve()` loads the built RSC entry (`dist/rsc/index.js` by default) and forwards requests to its fetch handler, which already serves prerendered routes, client assets, and RSC/SSR responses. Options: `port` (defaults to `PORT` or `3000`), `host`, `outDir`, and `entry`. Run from the project root so the handler can resolve `dist`.

Bun and Deno do not need the helper. Their native servers pass the handler a `Request` directly and expect a `Response`, so the Node-specific HTTP-to-Fetch bridging (streams, `duplex`, backpressure) is not needed:

```ts
// Bun
import handler from './dist/rsc/index.js'

Bun.serve({ fetch: request => handler.fetch(request) })
```

```ts
// Deno
import handler from './dist/rsc/index.js'

Deno.serve(request => handler.fetch(request))
```

The handler reads `dist` through `node:fs`, which Bun and Deno (2.x, via Node compat) provide. Run from the project root. Bun can also run `@jk2908/solas/node` as-is, since it implements `node:http`.

## Runtime

At request time Solas reads its output through an `Assets` interface (`exists`/`readText`/`readBuffer`/`mimeType`) injected into `createHandler`, defaulting to the Node standard library (which Bun runs natively). References are logical (`{ namespace, path }`), where the namespaces are `client` (Vite client output), `static` (full prerenders), and `artifact` (runtime manifest and ppr files). Platforms without a filesystem provide their own store; `@jk2908/solas/cloudflare` builds one around the `ASSETS` binding via `createWorker`. Build-time reads and writes use `node:fs` directly and are not abstracted.

## Scripts

Add scripts to your app:

```json
{
	"scripts": {
		"dev": "vite dev",
		"build": "vite build",
		"preview": "vite preview"
	}
}
```

If you run Vite through Bun, use the Bun-backed commands instead:

```json
{
	"scripts": {
		"dev": "bunx --bun vite dev",
		"build": "bunx --bun vite build",
		"preview": "bunx --bun vite preview"
	}
}
```

## Commands

- `vite dev` starts the development server.
- `vite build` creates a production build. Solas finalizes that build by prerendering configured routes, writing the runtime manifest, generating `sitemap.xml` when enabled, and precompressing output when enabled.
- `vite preview` serves the built app for local verification.

## Security

### CSRF

Solas protects server actions and `+endpoint` handlers against CSRF.

Server actions are always `POST` requests. `+endpoint` handlers are protected on browser-initiated `POST`, `PUT`, `PATCH`, and `DELETE` requests.

By default, browser requests must be same-origin.

When available, Solas checks browser provenance using:

- `Sec-Fetch-Site`
- `Origin`
- `Referer`

Solas also considers the effective request origin when your app is behind a proxy by using `X-Forwarded-Host` and `X-Forwarded-Proto`.

If you need to allow a trusted third-party browser POST source, configure it explicitly:

```ts
export default defineConfig({
	plugins: [
		solas({
			trustedOrigins: ['https://payments.example.com'],
		}),
	],
})
```

Requests from non-browser callers that do not send browser provenance headers are allowed by default, so typical server-to-server integrations and webhooks continue to work.

Cookie-backed app mutations should keep the default same-origin protection and only use `trustedOrigins` for narrowly scoped integrations that genuinely need cross-origin browser submissions.
