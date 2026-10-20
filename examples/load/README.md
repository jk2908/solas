# Solas load example

A deliberately expensive app for measuring Solas under render load. Every route is
parameterised, so the same build covers cheap baselines and saturated cases.

Nothing is prerendered. Each request walks the full pipeline: router, RSC render,
SSR, and the Node runtime.

## Run

From the repo root, make sure workspaces are linked:

```sh
bun install
```

Then, from this directory:

```sh
bun run dev       # vite dev on http://127.0.0.1:4321
bun run build     # production build
bun run preview   # vite preview on http://127.0.0.1:4321
bun run start     # built Node server on http://127.0.0.1:4321 (NODE_ENV=production)
```

`start` is a long-running server; stop it with Ctrl+C. `dev`, `preview`, and
`start` all use port 4321, so stop one before starting another. The Node runtime
has no startup banner unless `onListen` is provided, which is why `server.ts` logs
one.
It runs the same `dist` output as `preview`, but through `@jk2908/solas/runtime/node`
rather than Vite's preview bridge, so use it when measuring production behaviour.
`preview` strips `accept-encoding`, so it does not exercise precompressed assets.

`vite.config.ts` sets `precompress: true`, so `bun run build` emits brotli variants
of the client assets and `start` serves them with `content-encoding: br`. Dynamic
HTML and RSC responses are streamed and are not precompressed.

`@jk2908/solas/runtime/node` exports a named `serve` runtime helper used by `server.ts`.
It is not a Vite build adapter, so it does not belong in `vite.config.ts` or
`solas({ adapter })`.

## Routes

| route       | parameter  | default | range     | what it stresses                             |
| ----------- | ---------- | ------- | --------- | -------------------------------------------- |
| `/render`   | `rows`     | 2000    | 1–50000   | RSC payload and HTML size                    |
| `/render`   | `work`     | 2000    | 1–200000  | CPU per row                                  |
| `/stream`   | `sections` | 16      | 1–200     | number of Suspense boundaries                |
| `/stream`   | `work`     | 5000    | 1–200000  | CPU per section                              |
| `/stream`   | `delay`    | 0       | 0–5000ms  | how long sections stay pending               |
| `/client`   | `rows`     | 2000    | 1–50000   | hydration and reconciliation                 |
| `/client`   | `work`     | 200     | 1–20000   | CPU per row in the browser and on the server |
| `/links`    | `count`    | 500     | 1–5000    | RSC payload and client navigation            |
| `/api/work` | `work`     | 100000  | 1–2000000 | endpoint only, no RSC or SSR                 |

The `/render` response includes `data-rows`, `data-work`, and `data-compute-ms`
attributes so a load script can report the work it actually asked for.

## Benchmarking

Warm up, then drive a single route for a fixed duration. For example, with
[autocannon](https://github.com/mcollina/autocannon):

```sh
# server render throughput
npx autocannon -c 100 -d 30 -H "accept=text/html" \
  "http://127.0.0.1:4321/render?rows=2000&work=2000"

# streaming throughput
npx autocannon -c 100 -d 30 -H "accept=text/html" \
  "http://127.0.0.1:4321/stream?sections=16&work=5000"

# endpoint throughput
npx autocannon -c 100 -d 30 \
  "http://127.0.0.1:4321/api/work?work=100000"

# client navigation payload
npx autocannon -c 100 -d 30 -H "accept=text/x-component" \
  "http://127.0.0.1:4321/render?rows=2000&work=2000"
```

Scale `rows`/`work` until throughput flattens, then profile the process. The work
is deterministic, so runs are comparable. `oha`, `wrk`, and `bombardier` work too.

## Notes

- The work is a pure integer hash in `app/lib/work.ts`. It is CPU-bound on purpose;
  there is no I/O, database, or network noise.
- Defaults are modest so `bun run dev` stays responsive. Benchmarks should raise
  them.
- `/client` reports its render time after hydration to avoid a server/client markup
  mismatch; the heavy recomputation still happens during render.
- The Node runtime aborts `request.signal` and cancels the response stream when a
  client disconnects, so early-closed load tests do not leave work running.
