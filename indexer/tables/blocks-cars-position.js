import { createStoreBatchPutterClient } from './client.js'
import { encode } from '../data/blocks-cars-position.js'

/** @type {import('sst/constructs').TableProps} */
export const blocksCarsPositionTableProps = {
  fields: {
    blockmultihash: 'string',
    carpath: 'string',
    offset: 'number',
    length: 'number',
  },
  primaryIndex: { partitionKey: 'blockmultihash', sortKey: 'carpath' }
}

/**
 * @param {{ region: string } | import('@aws-sdk/client-dynamodb').DynamoDBClient} conf
 * @param {{ tableName: string }} context
 */
export const createBlocksCarsPositionStore = (conf, { tableName }) =>
  createStoreBatchPutterClient(conf, { tableName, encode })
