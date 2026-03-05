import { Drift } from '../../drift'

import { AUTOGEN_MSG } from './utils'

/**
 * Generates the RSC entry code
 * @returns the stringified code
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
    import { Router } from '${Drift.Config.PKG_NAME}/router'

    import { manifest } from './manifest'
    import { importMap } from './maps'
    import { config } from './config'
    import { createRouter } from './router'

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

      if (req[Drift.Config.$].action) opts = await action(req)

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

      const postponedState = runtimePpr
        ? await Prerender.Runtime.loadPostponedState(config.outDir, pathname)
        : null

      const artifactMetadata = runtimePpr
        ? await Prerender.Runtime.loadArtifactMetadata(config.outDir, pathname)
        : null

      const tryPrelude =
        !!artifactMetadata &&
        Prerender.Runtime.isArtifactCompatible(artifactMetadata, pathname, 'ppr')

      if (tryPrelude) {
        const prelude = await Prerender.Runtime.loadPrelude(config.outDir, pathname)

        // if we have a prelude and no postponed state, we can respond with the 
        // prelude immediately
        if (prelude && !postponedState) {
          return new Response(prelude, {
            headers: {
              'Cache-Control': 'private, no-store',
              'Content-Type': 'text/html',
              Vary: 'accept',
            },
            status,
          })
        }

        // otherwise, attempt to resume with the prelude and the postponed state
        if (postponedState) {
          const resumeStream = await mod.ssr.resume(stream, postponedState, {
            nonce: undefined,
            injectPayload: false,
          })

          const body = prelude
            ? Prerender.Runtime.composePreludeAndResume(prelude, resumeStream)
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

    const router = createRouter(handler)

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
          const prerenderPath = !fullyPrerenderedRoutes.has(pathname)
            ? null
            : pathname === '/'
              ? config.outDir + '/index.html'
              : config.outDir + pathname + '/index.html'

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
 * @returns the stringified code
 */
export function writeSSREntry() {
	return `
    ${AUTOGEN_MSG}
    
    export { ssr } from '${Drift.Config.PKG_NAME}/env/ssr'
  `.trim()
}

/**
 * Generates the browser entry code
 * @returns the stringified code
 */
export function writeBrowserEntry() {
	return `
    ${AUTOGEN_MSG}

    import { browser } from '${Drift.Config.PKG_NAME}/env/browser'

    browser()
  `.trim()
}
