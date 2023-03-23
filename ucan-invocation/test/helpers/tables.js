import { customAlphabet } from 'nanoid'

import { CreateTableCommand, GetItemCommand } from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'

import { dynamoDBTableConfig } from './resources.js'

/**
 * @param {import('@aws-sdk/client-dynamodb').DynamoDBClient} dynamo
 * @param {import("@serverless-stack/resources").TableProps} tableProps
 */
export async function createDynamoTable(dynamo, tableProps) {
  const id = customAlphabet('1234567890abcdefghijklmnopqrstuvwxyz', 10)
  const tableName = id()

  await dynamo.send(new CreateTableCommand({
    TableName: tableName,
    ...dynamoDBTableConfig(tableProps),
    ProvisionedThroughput: {
      ReadCapacityUnits: 1,
      WriteCapacityUnits: 1
    }
  }))

  return tableName
}

/**
 * @param {import('@aws-sdk/client-dynamodb').DynamoDBClient} dynamo
 * @param {string} tableName
 * @param {Record<string, string>} key
 */
export async function getItemFromTable(dynamo, tableName, key) {
  const params = {
    TableName: tableName,
    Key: marshall(key)
  }
  const response = await dynamo.send(new GetItemCommand(params))
  return response?.Item && unmarshall(response?.Item)
}