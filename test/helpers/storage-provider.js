import { putTableItem } from './table.js'
import { mustGetEnv } from '../../lib/env.js'

/**
 * Add the configured env var info for a storage node to the table.
 * 
 * The storage node info is configured via the following env vars:
 * ```
 * INTEGRATION_TESTS_STORAGE_PROVIDER_DID
 * INTEGRATION_TESTS_STORAGE_PROVIDER_ENDPOINT
 * INTEGRATION_TESTS_STORAGE_PROVIDER_PROOF
 * ```
 *
 * @param {object} params
 * @param {import('@aws-sdk/client-dynamodb').DynamoDBClient} params.client
 * @param {string} params.tableName
 */
export const addStorageProvider = async ({ client, tableName }) =>
  putTableItem(client, tableName, {
    provider: mustGetEnv('INTEGRATION_TESTS_STORAGE_PROVIDER_DID'),
    endpoint: mustGetEnv('INTEGRATION_TESTS_STORAGE_PROVIDER_ENDPOINT'),
    proof: mustGetEnv('INTEGRATION_TESTS_STORAGE_PROVIDER_PROOF'),
    weight: 100,
    insertedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  })
