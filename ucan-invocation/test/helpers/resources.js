import { GenericContainer as Container } from 'testcontainers'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'

/**
 * @param {object} [opts]
 * @param {number} [opts.port]
 * @param {string} [opts.region]
 */
export async function createDynamodDb(opts = {}) {
  const port = opts.port || 8000
  const region = opts.region || 'us-west-2'
  const dbContainer = await new Container('amazon/dynamodb-local:latest')
    .withExposedPorts(port)
    .start()

  const endpoint = `http://${dbContainer.getHost()}:${dbContainer.getMappedPort(8000)}`
  return {
    client: new DynamoDBClient({
      region,
      endpoint
    }),
    endpoint
  }
}

/**
 * Convert SST TableProps to DynamoDB `CreateTableCommandInput` config
 * 
 * @typedef {import('@aws-sdk/client-dynamodb').CreateTableCommandInput} CreateTableCommandInput
 * @typedef {import('@serverless-stack/resources').TableProps} TableProps
 *
 * @param {TableProps} props
 * @returns {Pick<CreateTableCommandInput, 'AttributeDefinitions' | 'KeySchema'>}
 */
export function dynamoDBTableConfig ({ fields, primaryIndex }) {
  if (!primaryIndex || !fields) throw new Error('Expected primaryIndex and fields on TableProps')
  const attributes = Object.values(primaryIndex)
  const AttributeDefinitions = Object.entries(fields)
    .filter(([k]) => attributes.includes(k)) // 'The number of attributes in key schema must match the number of attributes defined in attribute definitions'
    .map(([k, v]) => ({
      AttributeName: k,
      AttributeType: v[0].toUpperCase()
    }))
  const KeySchema = [
    { AttributeName: primaryIndex.partitionKey, KeyType: 'HASH' }
  ]
  if (primaryIndex.sortKey) {
    KeySchema.push(
      { AttributeName: primaryIndex.sortKey, KeyType: 'RANGE' }
    )
  }
  return {
    AttributeDefinitions,
    KeySchema
  }
}
