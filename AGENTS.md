# AGENTS.md

Guidance for agents working in this repo.

## TypeScript

- Infer return types. Do not annotate a function's return type unless inference produces something wrong or the annotation is load-bearing (recursion, a public interface with a narrower contract).
- Parameters and exported values can be annotated where it reads well.

## Commands

- `bun run lint` — oxlint.
- `bun run format` / `bun run format:check` — oxfmt (tabs, single quotes, no semicolons, print width 90). `dist`, `.solas` and `build` are ignored.
- `npm --prefix packages/solas run test` — vitest.
- `bun run release:check` — lint, `format:check` and the publish build. Run it before finishing.

## Docs

- README and CHANGELOG use British English (`normalise`, `behaviour`, `favour`) with no em dashes or AI jargon.
- The CHANGELOG follows Keep a Changelog, with `### Breaking` / `### Features` / `### Fixes` / `### Changed` sections.

## Messaging

- Use one module-scoped logger per subsystem: `const log = createLogger('build')`. Do not create a logger per message category or phase. Use `logger.child(scope)` only for a genuinely nested subsystem.
- Keep runtime exports flat. The `Solas` namespace is type-only: `Solas.Routes`, `Solas.Request`, `Solas.RequestMeta`, `Solas.ErrorCode`, `Solas.Error`. `ErrorCode`, `isSolasError` and `getVersion` are top-level runtime exports. `SolasError` is the internal class and is not exported from the package root.
- Do not put a `[scope]:` tag inside the message.
- Error messages start lowercase unless the first word is a proper noun or acronym, and do not end with punctuation. Put the fix in a one-line `hint`, which may be a full sentence with punctuation.
- CLI lines are sentence case and do not end with punctuation. Debug lines can be shorter.
- Throw `SolasError` (or a subclass) for framework errors internally. Pass the `ErrorCode` constant first, then the message, then an optional `hint`.
- Public error contracts are structural: `Solas.Error`, `BrowserRouterError`, `RouteTargetError`, `HttpRouterError` with `isSolasError`, `isBrowserRouterError`, `isRouteTargetError`, `isHttpRouterError`. Keep concrete error classes internal.
- Code values use `SCREAMING_SNAKE_CASE` with a `SOLAS_` prefix, for example `SOLAS_ROUTE_CONFLICT`. Add new values to `ErrorCode`; never invent a code at the call site.
- Keep colour out of thrown errors and raw strings. The logger applies colour only when the output is a TTY, so piped and CI output stays plain.
- CLI output uses symbols and columns: `build        ✓  Build complete`. Use `info` for progress, `success` for completed steps, `warn` for warnings, and `error` for failures. Do not log per-file work at `info`; use `debug` with a summary at `success`.
- Timestamps are off by default for CLI output. Server loggers pass `timestamps: 'iso'`.

## Adapters

- Build adapters live under `@jk2908/solas/adapters/*` and default-export a function named `adapter` (`cloudflare()`, the static adapter), so `import adapter from '@jk2908/solas/adapters/static'`. They return the `Adapter` shape (`name`, `plugins`, optional `prerender`) and are passed to `solas({ adapter })`. A platform with no server sets `prerender` on the returned `Adapter` to force the mode it needs.
- Runtime helpers live under `@jk2908/solas/runtime/*`. They execute at request time and are never passed to `solas({ adapter })`. The Node server is `import { serve } from '@jk2908/solas/runtime/node'`; to terminate TLS or HTTP/2 yourself, mount `createHttpRequestListener(handler)` or `createHttp2RequestListener(handler)` from the same entry on your own server. The Cloudflare worker and asset store are `import { createWorker, createCloudflareAssets } from '@jk2908/solas/runtime/cloudflare'`.
