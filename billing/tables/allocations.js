import { createStoreGetterClient, createStoreListerClient } from './client.js'
import { lister, decode, encodeKey } from '../data/allocations.js'

/**
 * Stores per space usage across billing periods.
 *
 * @type {import('sst/constructs').TableProps}
 */
export const allocationsTableProps = {
  fields: {
    /** Space DID (did:key:...). */
    space: 'string',
    /** Storage provider DID (did:web:...). */
    /** Represents a multihash digest which carries information about the hashing algorithm and an actual hash digest. */
    multihash: 'string',
    cause: 'string',
    /** ISO timestamp we created the invoice. */
    insertedAt: 'string',
    /** Number of bytes that were added to the space. */
    size: 'number',
  },
  primaryIndex: { partitionKey: 'space', sortKey: 'multihash' },
  globalIndexes: {
    'space-insertedAt-index': {
      partitionKey: 'space',
      sortKey: 'insertedAt',
      projection: ['multihash', 'cause', 'size'],
    },
  },
}

/**
 * @param {{ region: string } | import('@aws-sdk/client-dynamodb').DynamoDBClient} conf
 * @param {{ tableName: string }} context
 * @returns {import('../lib/api').AllocationStore}
 */
export const createAllocationStore = (conf, { tableName }) => ({
  ...createStoreGetterClient(conf, { tableName, encodeKey, decode }),
  ...createStoreListerClient(conf, {
    tableName,
    indexName: 'space-insertedAt-index',
    ...lister,
  }),
})
