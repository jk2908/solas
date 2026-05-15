# Changelog

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
