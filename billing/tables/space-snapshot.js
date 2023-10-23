import { createStoreGetterClient, createStorePutterClient } from './client.js'
import { validate, encode, decode, encodeKey } from '../data/space-snapshot.js'

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
 * @returns {import('../lib/api').SpaceSnapshotStore}
 */
export const createSpaceSnapshotStore = (region, tableName, options) => ({
  ...createStorePutterClient({ region }, { tableName, validate, encode }),
  ...createStoreGetterClient({ region }, { tableName, encodeKey, decode })
})
