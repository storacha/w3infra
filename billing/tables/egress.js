import { createStorePutterClient, createStoreListerClient } from './client.js'
import { validate, encode, lister, decode } from '../data/egress.js'

/**
 * Stores egress events for tracking requests served to customers.
 *
 * @type {import('sst/constructs').TableProps}
 */
export const egressTableProps = {
    fields: {
        /** Composite key with format: "customerId" */
        pk: 'string',
        /** Composite key with format: "timestamp#customerId#resourceId" */
        sk: 'string',
        /** Customer DID (did:mailto:...). */
        customerId: 'string',
        /** Resource CID. */
        resourceId: 'string',
        /** ISO timestamp of the event. */
        timestamp: 'string',
    },
    primaryIndex: { partitionKey: 'pk', sortKey: 'sk' }
}

/**
 * @param {{ region: string } | import('@aws-sdk/client-dynamodb').DynamoDBClient} conf
 * @param {{ tableName: string }} context
 * @returns {import('../lib/api.js').EgressEventStore}
 */
export const createEgressEventStore = (conf, { tableName }) => ({
  ...createStorePutterClient(conf, { tableName, validate, encode }),
    ...createStoreListerClient(conf, { tableName, encodeKey: lister.encodeKey, decode })
})
