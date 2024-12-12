import { createStoreGetterClient, createStoreListerClient } from './client.js'
import { lister, decode, encodeKey } from '../data/store.js'
import { storeTableProps } from '../../upload-api/tables/index.js'

export { storeTableProps }
/**
 * @param {{ region: string } | import('@aws-sdk/client-dynamodb').DynamoDBClient} conf
 * @param {{ tableName: string }} context
 * @returns {import('../lib/api.js').StoreTableStore}
 */
export const createStoreTableStore = (conf, { tableName }) => ({
  ...createStoreGetterClient(conf, { tableName, encodeKey, decode }),
  ...createStoreListerClient(conf, {
    tableName,
    indexName: 'space-insertedAt-index',
    ...lister,
  }),
})
