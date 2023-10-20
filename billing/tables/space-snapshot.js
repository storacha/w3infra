import { QueryCommand } from '@aws-sdk/client-dynamodb'
import { unmarshall } from '@aws-sdk/util-dynamodb'
import { connectTable, createWritableStoreClient } from './client.js'
import { validate, encode, decode } from '../data/space-snapshot.js'
import { RecordNotFound } from './lib.js'

/**
 * Stores snapshots of total space size at a given time.
 *
 * @type {import('@serverless-stack/resources').TableProps}
 */
export const spaceSnapshotTableProps = {
  fields: {
    /**
     * CSV Space DID and Provider DID.
     *
     * e.g. did:key:z6Mksjp3Mbe7TnQbYK43NECF7TRuDGZu9xdzeLg379Dw66mF,did:web:web3.storage
     */
    space: 'string',
    /** Total allocated size in bytes. */
    size: 'number',
    /** ISO timestamp allocation was snapshotted. */
    recordedAt: 'string',
    /** ISO timestamp record was inserted. */
    insertedAt: 'string'
  },
  primaryIndex: { partitionKey: 'space', sortKey: 'recordedAt' }
}

/**
 * @param {string} region 
 * @param {string} tableName
 * @param {object} [options]
 * @param {URL} [options.endpoint]
 * @returns {import('../types.js').SpaceSnapshotStore}
 */
export const createSpaceSnapshotStore = (region, tableName, options) => {
  const client = connectTable({ region })
  return {
    ...createWritableStoreClient({ region }, { tableName, validate, encode }),
    async getAfter ({ provider, space }, after) {
      const cmd = new QueryCommand({
        TableName: tableName,
        Limit: 1,
        KeyConditions: {
          space: {
            ComparisonOperator: 'EQ',
            AttributeValueList: [{ S: `${space},${provider}` }]
          },
          recordedAt: {
            ComparisonOperator: 'GT',
            AttributeValueList: [{ S: after.toISOString() }]
          }
        }
      })
      const res = await client.send(cmd)
      if (!res.Items || !res.Items.length) {
        return { error: new RecordNotFound({ provider, space, after: after.toISOString() }) }
      }
  
      const results = []
      for (const item of res.Items ?? []) {
        const decoding = decode(unmarshall(item))
        if (decoding.error) return decoding
        results.push(decoding.ok)
      }
  
      return { ok: results[0] }
    }
  }
}
