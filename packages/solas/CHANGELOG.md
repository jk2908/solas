# Changelog

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
