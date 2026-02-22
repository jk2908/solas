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
    import { Router } from '${Config.PKG_NAME}/router'

    import { manifest } from './manifest'
    import { importMap } from './maps'
    import { config } from './config'
    import { createRouter } from './router'

    const fullyPrerenderedRoutes = new Set(
      Object.values(manifest)
        .flat()
        .filter(
          (entry): entry is { __path: string; prerender: 'full' } =>
            'prerender' in entry && entry.prerender === 'full',
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
        opts?.returnValue, 
        opts?.formState, 
        opts?.temporaryReferences,
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

      const htmlStream = await mod.ssr(rscStream, { formState: opts?.formState, ppr })
                
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
        
        if (accept.includes('text/html')) {
          const pathname = url.pathname
          const prerenderPath = !fullyPrerenderedRoutes.has(pathname)
            ? null
            : pathname === '/'
              ? config.outDir + '/index.html'
              : config.outDir + pathname + '/index.html'

          if (prerenderPath) {
            const res = await Router.serve(prerenderPath, req, config.precompress, {
              'Cache-Control': 'public, max-age=31536000, immutable',
              'Content-Type': 'text/html; charset=utf-8',
            })

            if (res.status !== 404) return res
          }
        }
        
        return router.fetch(req)
      }
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
