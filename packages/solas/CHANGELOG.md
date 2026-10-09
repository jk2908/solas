# Changelog

## 0.8.1

### Fixes

- The Cloudflare adapter no longer copies precompressed `.br`/`.gz` assets into the Worker's asset output. The assets binding served the Worker the compressed body, which Cloudflare then compressed again at the edge, so a hard load of a prerendered route rendered as garbled binary (a double-encoded or header-mismatched response). The Worker now serves the uncompressed asset and the edge handles encoding.

## 0.8.0

### Features

- Added a platform `adapter` option to `solas()`. `solas({ adapter: cloudflare() })` registers the adapter's plugins alongside Solas's own instead of spreading them into the Vite plugins array.
- Added a Cloudflare adapter for the Cloudflare Vite plugin beta and the `cf` CLI (`cloudflare.config.ts`). `@jk2908/solas/cloudflare/vite` exports `cloudflare()`, and `@jk2908/solas/cloudflare` exports `createWorker()` and `createCloudflareAssets()`.
- Fully prerendered routes are now written to `dist/static` at their route paths. The Cloudflare adapter copies them under `/_solas-artifacts` so the Worker serves them.
- Added `@jk2908/solas/node`, a `serve()` helper that runs the built handler on a Node or Bun HTTP server.
- Request-time reads use an injected `Assets` store with logical `{ namespace, path }` references (`client`, `static`, `artifact`) instead of filesystem paths.

### Breaking

- Requires Vite 8 (Rolldown). The `vite` peer is now `^8.0.0`. Use Vite's `resolve.tsconfigPaths` instead of `vite-tsconfig-paths`, which breaks Rolldown's handling of the `file://` imports `@vitejs/plugin-rsc` emits.
- Removed the `Runtime` facade (`Runtime.set`/`Runtime.reset`) and the `Runtime` export from `@jk2908/solas/env/rsc`.
- `createHandler` now takes an options object as its fourth argument: `createHandler(config, manifest, importMap, { assets, runtimeManifest })`.

### Fixes

- Route modules are now executed in a standalone Vite environment resolved for `serve`, instead of a second Vite server that reloaded the config and cloned the plugin graph.
- The Cloudflare adapter pre-bundles the Worker environments so workerd never re-optimises dependencies mid-request, which previously split React across two instances in `vite dev`.
- The Cloudflare adapter sets `htmlHandling: none` and stores prerenders under `/_solas-artifacts`, so the asset layer no longer serves a prerendered document at its route path. Previously an RSC navigation (`Accept: text/x-component`) to a fully-prerendered route received HTML and failed to parse ("Connection closed").

## 0.7.0

### Breaking

- Removed the `runtime` config option and the Bun/Node runtime adapters. Solas now uses the Node standard library directly, which Bun runs natively, so there is no runtime selection to configure. Generated entries no longer call `createRuntime`.

## 0.6.0

### Breaking

- Removed the `Solas` runtime namespace exports (`Solas.Config`, `Solas.Runtime`, `Solas.Events`) from the `@jk2908/solas` entry. Runtime constants now live in dedicated internal modules, and generated code no longer reaches through the namespace.
- Removed the `@jk2908/solas/$` export path. Generated environment entries now import directly from `@jk2908/solas/env/rsc`.
- Removed the `port` config option from `solas()`. The development port now comes from Vite's `server.port`. `url` remains available as an optional public origin and now resolves from the `url` option → `VITE_APP_URL` → the Vite dev server `host`/`port`.

### Features

- Generated `.solas` files are formatted with oxfmt before writing, and stale generated files are pruned when the codegen stops emitting them.
- Added a Vitest test suite covering unit, integration, and browser (React Testing Library) tests.

### Fixes

- Generated `entry.rsc.tsx` now emits valid code (`loadManifest` from `env/rsc`) instead of referencing an undefined `Config` import.
- Fixed the release pipeline by committing the postbuild measurement script.

### Changed

- Pinned `@vitejs/plugin-rsc` to `0.5.34`.
- Removed the Playwright e2e suite, fixtures, and scripts for now; unit, integration, and browser tests run through Vitest.
- Declared `engines.node` (`^20.19.0 || >=22.12.0`).

## 0.5.4 - 2026-06-08

- Add a BrowserRouterHistory API to sync app back/forward navigation with browser navigation.
- Expose BrowserRouterContext.history for gated use in client components

## 0.5.3 - 2026-06-06

- Ensured `createRuntime(...)` is exported from `@jk2908/solas/env/rsc` for generated RSC entry compatibility.
- Clarified hotfix packaging so generated environment code can always import `createRuntime` from the public `env/rsc` export path.

## 0.5.2 - 2026-06-06

- Fixed browser bundling regressions caused by exposing runtime creation through `Solas.Runtime.create(...)` in the shared `$` export path.
- Removed `Solas.Runtime.create(...)` and moved runtime selection to a server-only `createRuntime(...)` helper under internal runtimes.
- Updated plugin/runtime entry generation to call `createRuntime(...)` from `env/rsc`, keeping browser-reachable modules free of Node runtime imports.

## 0.5.1 - 2026-06-06

- Fixed production app bundling by removing the `mime-types` package dependency from Solas runtime paths, preventing client bundles from resolving `/node_modules/mime-types/*` imports.
- Added an internal `getMimeTypeFromPath(...)` helper for Node runtime MIME resolution with a safe `application/octet-stream` fallback for unknown extensions.
- Removed obsolete `src/adapters/*` runtime adapter files so runtime selection now consistently uses the internal runtime implementations.

## 0.5.0 - 2026-06-06

- Added runtime selection via `runtime: 'auto' | 'node' | 'bun'`, with `auto` choosing Bun when available and falling back to Node otherwise.
- Removed the default Bun runtime requirement from the documented workflow. Standard `vite dev`, `vite build`, and `vite preview` commands now work on the default Node path, while Bun-backed Vite commands remain available when you want to run Solas in Bun.
- Added a dedicated `@jk2908/solas/$` runtime-safe export for generated/runtime code so preview and production server bundles no longer need to pull through the package root plugin entry.
- Fixed prerender static param resolution to stop depending on host support for `Promise.try`, so build-time route processing now works correctly under Node-based Vite runs.

## 0.4.5 - 2026-05-29

- Documented concrete `href` and `router.go(...)` usage in the README, including how explicit `query` values merge with an existing query string and take precedence for duplicate keys.
- Clarified in the README that `router.go(...)` and `router.refresh()` are awaitable, and that `router.refresh()` always refreshes the current browser location at call time.
- Fixed browser-router typing so `refresh` is exposed as a promise-returning method, matching the runtime implementation.

## 0.4.4 - 2026-05-29

- Added `router.refresh()` to the browser router, and made it clear that it clears the current route cache before fetching a fresh RSC payload.
- Reworked browser-router response caching so prefetched RSC responses can be reused by later navigations without a second fetch.
- Documented client routing and generated route typing in the README, including `useRouter()`, `router.go()`, `router.prefetch()`, `router.refresh()`, `Link` prefetch behaviour, and typed `Route.Metadata`/`Route.StaticParams` usage.
- Added a refresh demo route to the basic example app for manual regression testing.

## 0.4.3 - 2026-05-27

- Updated README docs to show that `dynamic()` must be awaited in request-time deferred `ppr` usage examples.
- Clarified route docs for `+endpoint.ts`, including that endpoint files can be placed anywhere in `app/` and how GET requests are resolved when `+page.tsx` and `+endpoint.ts` share a route.
- Tightened README language around experimental status, `url`, and `trustedOrigins`/CSRF guidance.

## 0.4.2 - 2026-05-22

- Changed `precompress` to default to `false`, so Solas no longer emits precompressed build output unless you opt in.
- Narrowed precompression to browser-served client assets and full prerendered HTML, so enabling `precompress` no longer writes `.br` files for internal `.solas` support artifacts.

## 0.4.1 - 2026-05-22

- Fixed redirect recovery during prerender and production HTML rendering, so redirecting routes now resolve as redirects instead of failing as generic Server Components render errors.
- Fixed build-time route export detection to ignore commented-out exports and transpile-only syntax before reading literal values, so stale commented `prerender` exports no longer change prerender mode.

## 0.4.0 - 2026-05-11

- Added CSRF protection for server actions and `+endpoint` handlers, plus a new `trustedOrigins` config option for tightly scoped cross-origin browser submissions. The checks are proxy-aware and use browser request headers when available.
- Added Vite `base` support across server routing, prerendering, and browser navigation, so apps mounted under a subpath resolve routes and generated asset URLs correctly.
- Changed static file handling so copied `public` files are served from the application root, while framework-generated files now live under the reserved `/_solas/*` path.
- Breaking: removed the `solas` CLI compatibility layer and switched the documented app scripts to Bun-backed Vite commands (`bunx --bun vite dev`, `build`, and `preview`).
- Moved Solas post-build work into the Vite plugin lifecycle, so prerendering, runtime manifest emission, sitemap generation, and precompression now run after the full app build instead of through an outer CLI wrapper.
- Added `Solas.Runtime.Manifest` and `Solas.Runtime.loadManifest(...)` for runtime artifact and public-file lookups, while keeping artifact-specific manifest types and helpers under `Prerender.Artifact`. The runtime manifest now lives at `dist/.solas/runtime-manifest.json` instead of under `.solas/ppr`.
- Stopped serialising stack traces in `HttpExceptionLike`, so server-rendered error payloads no longer include stacks.

## 0.3.9 - 2026-05-07

- Split shared `BrowserRouter` navigation types and target-building helpers into a dedicated internal module, so generated environments and type-only imports no longer need to pull through the full browser router runtime.
- Made the `solas()` plugin config argument optional.

## 0.3.8 - 2026-04-30

- Improved route module type safety for params, metadata, and static params, and ensured HTTP error boundaries receive route params too.
- Moved initial route-graph generation to Vite's `buildStart()` hook for more reliable build setup.
- Exported `HttpExceptionLike` from the public navigation api for typing serialised HTTP-style errors.
- Improved tree-shaking by keeping HMR-only browser runtime code out of non-HMR builds.
- Switched build-time export loading to Vite's module loader, so route exports resolve through Vite transforms and aliasing during builds.
- Fixed `abort(...)` during rendering so surfaced HTTP exceptions again resolve through the nearest matching boundary instead of failing as generic production render errors. This fixes a regression introduced in `0.3.7` when the outer `Suspense` was removed, while keeping that `Suspense` removed.

## 0.3.7 - 2026-04-25

- Fixed shell rendering so routes without a root `+loading` fallback no longer wrap the entire document in `Suspense`, which removes misplaced `<!--html-->`, `<!--head-->`, and `<!--body-->` markers from streamed HTML.

## 0.3.6 - 2026-04-24

- Fixed broken client-side `<Link />` navigation in Vite dev by excluding Solas browser runtime entry points from `optimizeDeps`, so the browser entry and client-reference router modules share a single `BrowserRouterContext` instance.

## 0.3.5 - 2026-04-23

- Fixed client-side navigation to same-origin routes that later resolve to a 404 or error state by committing the target URL to browser history before the RSC payload finishes loading, so broken internal links no longer leave the route unchanged.

## 0.3.4 - 2026-04-23

- Fixed `hydrateRoot` missing named export error in the browser by removing the erroneous `optimizeDeps.exclude` for `react-dom/client`. Excluding it prevented Vite from pre-bundling the CommonJS wrapper, so the named export was never exposed to browser ESM consumers.

## 0.3.3 - 2026-04-23

- Fixed HTML missing-route rendering when Solas is installed from npm by serialising `HttpException` and `Error` values into transport-safe objects before they cross the RSC payload boundary, preserving the expected 404 flow instead of crashing during SSR.

## 0.3.2 - 2026-04-21

- Fixed PPR flight transport and closed-connection handling by replacing `rsc-html-stream` with the local runtime transport.
- Fixed prerender artifact manifest handling for dynamic params by writing the final built artifact manifest and using it for runtime artifact lookups.

## 0.3.1 - 2026-04-07

- Fixed `useSearchParams()` client builds.
- Reworked the code generators to keep the source templates readable while still emitting tidy generated files.
- Added a shared template dedent helper for generated source and tightened nested object and route map indentation.
- Made generated config output emit logger code only when a logger level is configured.

## 0.3.0 - 2026-04-07

- Fixed `useSearchParams()` hydration so query-driven ui uses the initial request url on first render.
- Switched internal runtime and generated imports to explicit `.js` specifiers, and corrected the router action import path.
- Simplified generated config, manifest, and route map output to emit source literals directly.
- Removed the generated-file formatting pass and deleted the internal `Format` helper.
- Documented that the Solas cli currently requires Bun 1.2+ on `PATH`.

## 0.2.3 - 2026-04-02

- Previous release.
