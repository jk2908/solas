import { Config } from '../../config'

import { AUTOGEN_MSG } from './utils'

/**
 * Generates the RSC entry code
 * @returns the stringified code
 */
export function writeRSCEntry() {
	return `
    ${AUTOGEN_MSG}

  import type { ReactFormState } from 'react-dom/client'

  import type { DriftRequest } from '${Config.PKG_NAME}'
  import { rsc, action } from '${Config.PKG_NAME}/env/rsc'
  import { Prerender } from '${Config.PKG_NAME}/server'
  import { Router } from '${Config.PKG_NAME}/router'

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

      if (req.method === 'POST') opts = await action(req)

      const { stream: rscStream, status, ppr } = await rsc(
        req,
        manifest,
        importMap,
        config.metadata,
        opts.returnValue,
        opts.formState,
        opts.temporaryReferences,
      )

      if (!req.headers.get('accept')?.includes('text/html')) {
        return new Response(rscStream, {
          headers: {
            'Cache-Control': 'private, no-store',
            'Content-Type': 'text/x-component; charset=utf-8',
            Vary: 'accept',
          },
          status,
        })
      }

      const mod = await import.meta.viteRsc.loadModule<typeof import('./entry.ssr.tsx')>(
        'ssr',
        'index',
      )

      const pathname = new URL(req.url).pathname

      if (
        req.headers.get('x-drift-prerender') === '1' &&
        req.headers.get('x-drift-prerender-artifact') === '1'
      ) {
        const artifact = await mod.ssr.prerender(rscStream, {
          formState: opts.formState,
          ppr,
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

      const postponedState = ppr
        ? await Prerender.loadPostponedState(config.outDir, pathname)
        : null

      if (postponedState) {
        const prelude = await Prerender.loadPrelude(config.outDir, pathname)
        const resumeStream = await mod.ssr.resume(rscStream, postponedState, {
          nonce: undefined,
          injectPayload: false,
        })

        const body = prelude
          ? Prerender.composePreludeAndResume(prelude, resumeStream)
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

      const htmlStream = await mod.ssr(rscStream, {
        formState: opts.formState,
        ppr,
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

    const router = createRouter()

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
    
    export { ssr } from '${Config.PKG_NAME}/env/ssr'
  `.trim()
}

/**
 * Generates the browser entry code
 * @returns the stringified code
 */
export function writeBrowserEntry() {
	return `
    ${AUTOGEN_MSG}

    import { browser } from '${Config.PKG_NAME}/env/browser'

    browser()
  `.trim()
}
