import { createStorePutterClient, createStoreListerClient } from './client.js'
import { validate, encode, lister, decode } from '../data/egress.js'

/**
 * Source of truth for egress traffic data.
 *
 * @type {import('sst/constructs').TableProps}
 */
export const egressTrafficTableProps = {
  fields: {
    /** Composite key with format: "space#resource" */
    pk: 'string',
    /** Composite key with format: "servedAt#cause" */
    sk: 'string',
    /** Space DID (did:key:...). */
    space: 'string',
    /** Customer DID (did:mailto:...). */
    customer: 'string',
    /** Resource CID. */
    resource: 'string',
    /** ISO timestamp of the event. */
    servedAt: 'string',
    /** Bytes served. */
    bytes: 'number',
    /** UCAN invocation ID that caused the egress traffic. */
    cause: 'string',
  },
  primaryIndex: { partitionKey: 'pk', sortKey: 'sk' },
  globalIndexes: {
    customer: {
      partitionKey: 'customer',
      sortKey: 'sk',
      projection: ['space', 'resource', 'bytes', 'cause', 'servedAt']
    }
  }
}

/**
 * @param {{ region: string } | import('@aws-sdk/client-dynamodb').DynamoDBClient} conf
 * @param {{ tableName: string }} context
 * @returns {import('../lib/api.js').EgressTrafficEventStore}
 */
export const createEgressTrafficEventStore = (conf, { tableName }) => ({
  ...createStorePutterClient(conf, { tableName, validate, encode }),
  ...createStoreListerClient(conf, { tableName, encodeKey: lister.encodeKey, decode })
})