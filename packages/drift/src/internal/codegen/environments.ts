import { Drift } from '../../drift'

import { AUTOGEN_MSG } from './utils'

/**
 * Generates the RSC entry code
 */
export function writeRSCEntry() {
	return `
    ${AUTOGEN_MSG}

    import type { ReactFormState } from 'react-dom/client'

    import { Drift } from '${Drift.Config.PKG_NAME}'
    import type { DriftRequest } from '${Drift.Config.PKG_NAME}'
    import { rsc, action } from '${Drift.Config.PKG_NAME}/env/rsc'
    import type { SSR } from '${Drift.Config.PKG_NAME}/env/ssr'
    import { Prerender } from '${Drift.Config.PKG_NAME}/prerender'
    import { createRouter, Router } from '${Drift.Config.PKG_NAME}/router'

    import { manifest } from './manifest'
    import { importMap } from './maps'
    import { config } from './config'

    const fullyPrerenderedRoutes = new Set<string>(
      Object.values(manifest)
        .flat()
        .filter(
          entry =>
            'prerender' in entry &&
            String(entry.prerender) === 'full',
        )
        .map(entry => entry.__path),
    )

    export async function handler(req: DriftRequest) {
      let opts: {
        formState?: ReactFormState
        temporaryReferences?: unknown
        returnValue?: { ok: boolean; data: unknown }
      } = {
        formState: undefined,
        temporaryReferences: undefined,
        returnValue: undefined,
      }

      if (req[Drift.Config.REQUEST_META].action) opts = await action(req)

      const { stream: rscStream, status, ppr } = await rsc(
        req,
        manifest,
        importMap,
        config.metadata,
        opts.returnValue,
        opts.formState,
        opts.temporaryReferences,
      )

      const stream = await rscStream

      if (!req.headers.get('accept')?.includes('text/html')) {
        return new Response(stream, {
          headers: {
            'Cache-Control': 'private, no-store',
            'Content-Type': 'text/x-component; charset=utf-8',
            Vary: 'accept',
          },
          status,
        })
      }

      const mod = await import.meta.viteRsc.loadModule<{ ssr: SSR }>(
        'ssr',
        'index',
      )

      const pathname = new URL(req.url).pathname
      const runtimePpr = !import.meta.env.DEV && ppr

      if (
        req.headers.get('x-drift-prerender') === '1' &&
        req.headers.get('x-drift-prerender-artifact') === '1'
      ) {
        const artifact = await mod.ssr.prerender(stream, {
          formState: opts.formState,
          ppr: runtimePpr,
          route: pathname,
        })

        return new Response(JSON.stringify(artifact), {
          headers: {
            'Cache-Control': 'private, no-store',
            'Content-Type': 'application/json; charset=utf-8',
            Vary: 'accept',
          },
          status,
        })
      }

      const artifactManifest = runtimePpr
        ? await Prerender.Artifact.loadManifest(config.outDir)
        : null
      const artifactManifestEntry = artifactManifest?.routes[pathname] ?? null

      let tryPrelude = false

      if (artifactManifestEntry) {
        tryPrelude = artifactManifestEntry.mode === 'ppr'
      } else if (runtimePpr) {
        const artifactMetadata = await Prerender.Artifact.loadMetadata(config.outDir, pathname)

        tryPrelude =
          !!artifactMetadata &&
          Prerender.Artifact.isCompatible(artifactMetadata, pathname, 'ppr')
      }

      if (tryPrelude) {
        const postponedState = await Prerender.Artifact.loadPostponedState(
          config.outDir,
          pathname,
        )
        const prelude = await Prerender.Artifact.loadPrelude(config.outDir, pathname)

        // otherwise, attempt to resume with the prelude and the postponed state
        if (postponedState) {
          const resumeStream = await mod.ssr.resume(stream, postponedState, {
            nonce: undefined,
            injectPayload: true,
          })

          const body = prelude
            ? Prerender.Artifact.composePreludeAndResume(prelude, resumeStream)
            : resumeStream

          return new Response(body, {
            headers: {
              'Cache-Control': 'private, no-store',
              'Content-Type': 'text/html',
              Vary: 'accept',
            },
            status,
          })
        }
      }

      const htmlStream = await mod.ssr(stream, {
        formState: opts.formState,
        ppr: runtimePpr,
      })

      return new Response(htmlStream, {
        headers: {
          'Cache-Control': 'private, no-store',
          'Content-Type': 'text/html',
          Vary: 'accept',
        },
        status,
      })
    }

    const router = createRouter(config, manifest, importMap, handler)

    export default {
      async fetch(req: Request) {
        const url = new URL(req.url)
        const accept = req.headers.get('accept') ?? ''

        // for normal html requests we serve fully prerendered documents directly
        // from disk when available
        //
        // build-time artifact requests must bypass this path and hit the router
        // handler so the cli receives the JSON artifacts instead of html
        if (
          !import.meta.env.DEV &&
          accept.includes('text/html') &&
          req.headers.get('x-drift-prerender-artifact') !== '1'
        ) {
          const pathname = url.pathname
          let prerenderPath: string | null = null
          const artifactManifest = await Prerender.Artifact.loadManifest(config.outDir)
          const artifactManifestEntry = artifactManifest?.routes[pathname] ?? null

          if (fullyPrerenderedRoutes.has(pathname)) {
            prerenderPath =
              pathname === '/'
                ? config.outDir + '/index.html'
                : config.outDir + pathname + '/index.html'
          } else if (artifactManifestEntry) {
            if (artifactManifestEntry.mode === 'full') {
              prerenderPath =
                pathname === '/'
                  ? config.outDir + '/index.html'
                  : config.outDir + pathname + '/index.html'
            }
          } else {
            const artifactMetadata = await Prerender.Artifact.loadMetadata(
              config.outDir,
              pathname,
            )

            if (
              artifactMetadata &&
              Prerender.Artifact.isCompatible(artifactMetadata, pathname, 'full')
            ) {
              prerenderPath =
                pathname === '/'
                  ? config.outDir + '/index.html'
                  : config.outDir + pathname + '/index.html'
            }
          }

          if (prerenderPath) {
            const res = await Router.serve(prerenderPath, req, config.precompress, {
              // avoid shared/proxy caching for framework users unless 
              // they explicitly opt into public caching (todo)
              'Cache-Control': 'private, no-store',
              'Content-Type': 'text/html; charset=utf-8',
            })

            if (res.status !== 404) return res
          }
        }

        return router.fetch(req)
      },
    }

    import.meta.hot?.accept()
  `.trim()
}

/**
 * Generates the SSR entry code
 */
export function writeSSREntry() {
	return `
    ${AUTOGEN_MSG}
    
    export { ssr } from '${Drift.Config.PKG_NAME}/env/ssr'
  `.trim()
}

/**
 * Generates the browser entry code
 */
export function writeBrowserEntry() {
	return `
    ${AUTOGEN_MSG}

    import { browser } from '${Drift.Config.PKG_NAME}/env/browser'

    browser()
  `.trim()
}
