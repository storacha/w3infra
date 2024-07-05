import {
  DynamoDBClient,
  QueryCommand
} from '@aws-sdk/client-dynamodb'
import { unmarshall } from '@aws-sdk/util-dynamodb'
import { mustGetEnv } from '../lib/env.js'

export async function fetchMetricsForSpaceCmd () {
  const {
    ENV,
    SPACE_DID,
    TABLE_NAME,
  } = getEnv()

  const { client, tableName } = getDynamoDb(
    TABLE_NAME,
    ENV,
    getRegion(ENV)
  )

  const rows = await getAllTableRows(client, tableName, SPACE_DID)
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
    ENV: mustGetEnv('ENV'),
    SPACE_DID: mustGetEnv('SPACE_DID'),
    TABLE_NAME: mustGetEnv('TABLE_NAME'),
  }
}

/**
 * @param {string} env
 */
function getRegion (env) {
  if (env === 'staging') {
    return 'us-east-2'
  }

  return 'us-west-2'
}

/**
 * @param {string} tableName
 * @param {string} env
 * @param {string} region
 */
function getDynamoDb (tableName, env, region) {
  const endpoint = `https://dynamodb.${region}.amazonaws.com`

  return {
    client: new DynamoDBClient({
      region,
      endpoint
    }),
    tableName: `${env}-w3infra-${tableName}`,
    endpoint
  }
}