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

## Adapters

- Build adapters live under `@jk2908/solas/adapters/*` and default-export a function named `adapter` (`cloudflare()`, the static adapter), so `import adapter from '@jk2908/solas/adapters/static'`. They return the `Adapter` shape (`name`, `plugins`, optional `prerender`) and are passed to `solas({ adapter })`. A platform with no server sets `prerender` on the returned `Adapter` to force the mode it needs.
- Runtime helpers live under `@jk2908/solas/runtime/*`. They execute at request time and are never passed to `solas({ adapter })`. The Node server is `import { serve } from '@jk2908/solas/runtime/node'`; to terminate TLS or HTTP/2 yourself, mount `createHttpRequestListener(handler)` or `createHttp2RequestListener(handler)` from the same entry on your own server. The Cloudflare worker and asset store are `import { createWorker, createCloudflareAssets } from '@jk2908/solas/runtime/cloudflare'`.
