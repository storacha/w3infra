import { GetItemCommand, ScanCommand } from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'

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
 * @param {import("@aws-sdk/client-dynamodb").DynamoDBClient} dynamo
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
