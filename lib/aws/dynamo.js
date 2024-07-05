import { DynamoDBClient } from '@aws-sdk/client-dynamodb'

/** @type {Record<string, import('@aws-sdk/client-dynamodb').DynamoDBClient>} */
const dynamoClients = {}

/** @param {{ region: string, endpoint?: string }} config */
export function getDynamoClient (config) {
  const key = `${config.region}#${config.endpoint ?? 'default'}`
  if (!dynamoClients[key]) {
    dynamoClients[key] = new DynamoDBClient(config)
  }
  return dynamoClients[key]
}
