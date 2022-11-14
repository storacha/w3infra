import { createStoreService } from './store/index.js'

/**
 * @param {import('./types').UcantoServerContext} context
 * @returns {Record<string, any>}
 */
export function createServiceRouter (context) {
  return {
    store: createStoreService(context),
    // TODO: upload
  }
}
