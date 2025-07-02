import { GetItemCommand, QueryCommand, ScanCommand, PutItemCommand } from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
import pRetry from 'p-retry'

/**
 * @param {import('@aws-sdk/client-dynamodb').DynamoDBClient} dynamo
 * @param {string} tableName
 * @param {object} key
 */
export async function getTableItem (dynamo, tableName, key) {
  const cmd = new GetItemCommand({
    TableName: tableName,
    Key: marshall(key)
  })

  const response = await dynamo.send(cmd)
  return response.Item && unmarshall(response.Item)
}

/**
 * @param {import('@aws-sdk/client-dynamodb').DynamoDBClient} dynamo
 * @param {string} tableName
 * @param {any} record
 */
export async function putTableItem (dynamo, tableName, record) {
  const putCmd = new PutItemCommand({
    TableName: tableName,
    Item: marshall(record, {
      removeUndefinedValues: true
    }),
  })

  await dynamo.send(putCmd)
}

/**
 * @param {import('@aws-sdk/client-dynamodb').DynamoDBClient} dynamo
 * @param {string} tableName
 * @param {Record<string, import('@aws-sdk/client-dynamodb').Condition>} keyConditions
 * @param {object} [options]
 * @param {string} [options.indexName]
 */
export async function pollQueryTable (dynamo, tableName, keyConditions, options = {}) {
  const cmd = new QueryCommand({
    TableName: tableName,
    KeyConditions: keyConditions,
    IndexName: options.indexName,
  })

  const response = await pRetry(async () => {
    const r = await dynamo.send(cmd)
    if (r.$metadata.httpStatusCode === 404 || !r.Count) {
      throw new Error(`not found in ${tableName} table yet`)
    }
    return r
  }, {
    maxTimeout: 2000,
    minTimeout: 1000,
    retries: 100
  })

  return response?.Items && response?.Items.map(i => unmarshall(i))
}

/**
 * @param {import('@aws-sdk/client-dynamodb').DynamoDBClient} dynamo
 * @param {string} tableName
 * @param {object} [options]
 * @param {number} [options.limit]
 */
export async function getAllTableRows (dynamo, tableName, options = {}) {
  const cmd = new ScanCommand({
    TableName: tableName,
    Limit: options.limit || 30
  })
  
  const response = await dynamo.send(cmd)
  return response.Items?.map(i => unmarshall(i)) || []
}
