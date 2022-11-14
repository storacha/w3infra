import { storeAddProvider } from './add.js'

/**
 * @param {import('../types').StoreServiceContext} context
 */
 export function createStoreService (context) {
  return {
    add: storeAddProvider(context)
  }
}
