# Solas route groups example

A small app showing route groups: directories wrapped in parentheses that organise
routes without adding a URL segment.

```text
app/
	+layout.tsx
	(marketing)/
		+layout.tsx
		+page.tsx              -> /
		about/+page.tsx        -> /about
		pricing/+page.tsx      -> /pricing
		blog/[slug]/+page.tsx  -> /blog/:slug
	(app)/
		+layout.tsx
		+middleware.ts
		dashboard/+page.tsx    -> /dashboard
		settings/+page.tsx     -> /settings
		api/health/+endpoint.ts -> /api/health
```

## Run

From the repo root, make sure workspaces are linked:

```sh
bun install
```

Then, from this directory:

```sh
bun run dev       # vite dev on http://127.0.0.1:4330
bun run build     # production build
bun run preview   # vite preview on http://127.0.0.1:4330
bun run start     # built Node server on http://127.0.0.1:4330
```

## What to look at

- `/` is rendered by `(marketing)/+page.tsx`, not by a root `+page.tsx`. The group
  layout wraps it without adding `/marketing` to the URL.
- `/dashboard` and `/settings` share `(app)/+layout.tsx`.
- `(app)/+middleware.ts` adds an `x-route-group: app` response header. It applies to
  both pages and the `/api/health` endpoint inside the group.
- `/api/health` is an endpoint inside a group. Groups organise endpoints as well as
  pages, and group middleware still applies.
- `/blog/hello` shows a dynamic segment inside a group.

Try `curl -i http://127.0.0.1:4330/dashboard` to see the middleware header, or
`curl -i http://127.0.0.1:4330/api/health` for the endpoint response.

The root `app/+layout.tsx` remains the app shell. Route groups add nested layouts;
they do not provide an independent shell.
