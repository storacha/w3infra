
import { QueryCommand } from '@aws-sdk/client-dynamodb'
import { asDIDMailto } from '../../data/lib.js'
import { mustGetEnv } from '../../functions/lib.js'
import { createStoreGetterClient, createStoreListerClient } from '../../tables/client.js'
import { getDynamo } from './lib.js'
import { encodeKey, decode } from '../../data/usage.js'

/**
 * @param {object} config
 * @param {string} config.customer
 * @param {string} config.datetime
 */
export const usage = async (config) => {
  const customer = asDIDMailto(config.customer)
  const from = new Date(config.datetime)
  if (isNaN(from.getTime())) {
    console.error('invalid ISO date')
    process.exit(1)
  }

  const tableName = mustGetEnv('USAGE_TABLE_NAME')

  const dynamo = getDynamo()

  const cmd = new QueryCommand({
    TableName: tableName,
    KeyConditions: {
      customer: {
        ComparisonOperator: 'EQ',
        AttributeValueList: [{ S: customer }]
      },
      from: {
        ComparisonOperator: 'GE',
        AttributeValueList: [{ S: from.toISOString() }]
      }
    }
  })

  await dynamo.send(cmd)
}
