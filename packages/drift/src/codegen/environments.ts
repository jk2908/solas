import { Config } from '../config'

import { AUTOGEN_MSG } from './utils'

/**
 * Generates the RSC entry code
 * @returns the stringified code
 */
export function writeRSCEntry() {
	return `
    ${AUTOGEN_MSG}

    import type { ReactFormState } from 'react-dom/client'

    import { rsc, action } from '${Config.PKG_NAME}/render/env/rsc'

    import { manifest } from './manifest'
    import { importMap } from './maps'
    import { config } from './config'
    import { createRouter } from './router'

    export async function handler(req: Request) { 
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

      const { stream: rscStream, status } = await rsc(
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
            'Content-Type': 'text/x-component;charset=utf-8',
            vary: 'accept',
          },
          status,
        })
      }

      const mod = await import.meta.viteRsc.loadModule<typeof import('./entry.ssr.tsx')>(
        'ssr',
        'index',
      )

      const htmlStream = await mod.ssr(rscStream, opts?.formState)
                
      return new Response(htmlStream, {
        headers: {
          'Content-Type': 'text/html',
          vary: 'accept',
        },
        // use rsc status code?
        status,
      })
    }

    import.meta.hot?.accept()

    // this is the rsc entrypoint
    export default createRouter()
  `.trim()
}

/**
 * Generates the SSR entry code
 * @returns the stringified code
 */
export function writeSSREntry() {
	return `
    ${AUTOGEN_MSG}
    
    export { ssr } from '${Config.PKG_NAME}/render/env/ssr'
  `.trim()
}

/**
 * Generates the browser entry code
 * @returns the stringified code
 */
export function writeBrowserEntry() {
	return `
    ${AUTOGEN_MSG}

    import { browser } from '${Config.PKG_NAME}/render/env/browser'

    browser()
  `.trim()
}
