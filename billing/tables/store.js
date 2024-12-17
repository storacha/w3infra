import { createStoreGetterClient, createStoreListerClient } from './client.js'
import { lister, decode, encodeKey } from '../data/store.js'
import { listBetweenWithConfig } from './allocations.js'

/**
 * @type {import('sst/constructs').TableProps}
 */
export const storeTableProps = {
  fields: {
    space: 'string', // `did:key:space`
    link: 'string', // `bagy...1`
    size: 'number', // `101`
    origin: 'string', // `bagy...0` (prev CAR CID. optional)
    issuer: 'string', // `did:key:agent` (issuer of ucan)
    invocation: 'string', // `baf...ucan` (CID of invcation UCAN)
    insertedAt: 'string', // `2022-12-24T...`
  },
  // space + link must be unique to satisfy index constraint
  primaryIndex: { partitionKey: 'space', sortKey: 'link' },
  globalIndexes: {
    cid: {
      partitionKey: 'link',
      sortKey: 'space',
      projection: ['space', 'insertedAt'],
    },
    'space-insertedAt-index': {
      partitionKey: 'space',
      sortKey: 'insertedAt',
      projection: ['size'],
    },
  },
}

const indexName = 'space-insertedAt-index'

/**
 * @param {{ region: string } | import('@aws-sdk/client-dynamodb').DynamoDBClient} conf
 * @param {{ tableName: string }} context
 * @returns {import('../lib/api.js').StoreTableStore}
 */
export const createStoreTableStore = (conf, { tableName }) => ({
  ...createStoreGetterClient(conf, { tableName, encodeKey, decode }),
  ...createStoreListerClient(conf, {
    tableName,
    indexName,
    ...lister,
  }),
  listBetween: (space, from, to, options) =>
    listBetweenWithConfig(
      { conf, tableName, indexName, decode: lister.decode },
      { space, from, to, options }
    ),
})
