# Changelog

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
