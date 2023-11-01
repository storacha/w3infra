import { DynamoDB, QueryCommand } from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
import { mustGetEnv } from '../../functions/lib.js'
import * as Consumer from '../../data/consumer.js'

export const getDynamo = () => {
  let credentials
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    credentials = {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
  }
  return new DynamoDB({ region: process.env.AWS_REGION, credentials })
}

/** @param {Date} d */
export const isValidDate = (d) => {
  return !isNaN(d.getTime())
}

/**
 * @param {import('@aws-sdk/client-dynamodb').DynamoDBClient} dynamo
 * @param {string} space
 */
export async function getConsumerBySpace (dynamo, space) {
  const res = await dynamo.send(new QueryCommand({
    TableName: mustGetEnv('CONSUMER_TABLE_NAME'),
    IndexName: 'consumer',
    KeyConditionExpression: "consumer = :consumer",
    ExpressionAttributeValues: marshall({
      ":consumer": space
    })
  }))
  if (!res.Items || res.Items.length === 0) {
    throw new Error(`Failed to get consumer for ${space}`)
  }
  const decoded = Consumer.lister.decode(unmarshall(res.Items[0]))
  if (decoded.error) {
    throw new Error(decoded.error.message)
  }
  return decoded.ok
}
