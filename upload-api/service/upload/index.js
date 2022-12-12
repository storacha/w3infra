import { uploadAddProvider } from './add.js'
import { uploadListProvider } from './list.js'
import { uploadRemoveProvider } from './remove.js'

/**
 * @param {import('../types').UploadServiceContext} context
 */
 export function createUploadService (context) {
  return {
    add: uploadAddProvider(context),
    list: uploadListProvider(context),
    remove: uploadRemoveProvider(context)
  }
}
