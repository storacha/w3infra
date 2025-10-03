import { DynamoDBClient } from '@aws-sdk/client-dynamodb'

/**
 * @typedef {{ region: string, endpoint?: string }} Address
 */

/** @type {Record<string, import('@aws-sdk/client-dynamodb').DynamoDBClient>} */
const dynamoClients = {}

/** @param {Address} config */
export function getDynamoClient (config) {
  const key = `${config.region}#${config.endpoint ?? 'default'}`
  if (!dynamoClients[key]) {
    dynamoClients[key] = new DynamoDBClient(config)
  }
  return dynamoClients[key]
}
