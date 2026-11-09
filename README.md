# Solas

Main framework documentation:

- [packages/solas/README.md](packages/solas/README.md)

## Development CSS note

In development, Solas emits a blocking `?direct` stylesheet link for client component CSS to avoid a flash of unstyled content. Vite also injects its HMR `<style>` for the same module, so the CSS appears twice in dev. This is expected and does not happen in production; this may be looked at in future.

## Prefetch note

Automatic viewport prefetch runs after page load and an idle period. Fully prerendered routes are prefetched in full; PPR and dynamic routes currently return no prefetch payload and navigate normally. Prefetching only their shell is a possible future change.
