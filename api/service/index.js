import { createStoreService } from './store/index.js'
import { createUploadService } from './upload/index.js'

/**
 * @param {import('./types').UcantoServerContext} context
 * @returns {Record<string, any>}
 */
export function createServiceRouter (context) {
  return {
    store: createStoreService(context),
    upload: createUploadService(context)
  }
}
