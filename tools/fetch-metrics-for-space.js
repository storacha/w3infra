import { QueryCommand } from '@aws-sdk/client-dynamodb'
import { unmarshall } from '@aws-sdk/util-dynamodb'
import { mustGetEnv } from '../lib/env.js'
import { getRegion, getStage } from './lib.js'
import { getDynamoClient } from '../lib/aws/dynamo.js'

export async function fetchMetricsForSpaceCmd () {
  const {
    SPACE_DID,
    TABLE_NAME,
  } = getEnv()
  const stage = getStage()
  const region = getRegion(stage)
  const dynamo = getDynamoClient({ region })

  const rows = await getAllTableRows(dynamo, TABLE_NAME, SPACE_DID)
  console.log(`Metrics found for provided space DID: ${rows.length}`)
  for (const row of rows) {
    console.log(`${row.name}: ${row.value}`)
  }
}

/**
 * @param {import('@aws-sdk/client-dynamodb').DynamoDBClient} dynamo
 * @param {string} tableName
 * @param {string} space
 * @param {object} [options]
 * @param {number} [options.limit]
 */
export async function getAllTableRows (dynamo, tableName, space, options = {}) {
  const cmd = new QueryCommand({
    TableName: tableName,
    Limit: options.limit || 30,
    KeyConditions: {
      space: {
        ComparisonOperator: 'EQ',
        AttributeValueList: [{ S: space }],
      },
    }
  })
  
  const response = await dynamo.send(cmd)
  return response.Items?.map(i => unmarshall(i)) || []
}

/**
 * Get Env validating it is set.
 */
function getEnv() {
  return {
    SPACE_DID: mustGetEnv('SPACE_DID'),
    TABLE_NAME: mustGetEnv('TABLE_NAME'),
  }
}
