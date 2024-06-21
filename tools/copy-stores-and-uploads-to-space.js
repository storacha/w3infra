import {
  BatchWriteItemCommand,
  DynamoDBClient,
  QueryCommand
} from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'

/**
 * This script can be used to copy a space's stores and uploads to a different space. This
 * will allow us to help users recover access to spaces that they did not save a recovery
 * key for.
 */

export async function copyStoresAndUploadsToNewSpace(oldSpaceDid, newSpaceDid) {
  console.log(oldSpaceDid, newSpaceDid)
  const {
    W3UP_ENV,
  } = getEnv()

  const { client: storeClient, tableName: storeTableName } = getDynamoDb(
    'store',
    W3UP_ENV,
    getRegion(W3UP_ENV)
  )

  const storeRows = getAllTableRows(storeClient, storeTableName, oldSpaceDid)
  const storeResults = []
  // this will run out of memory if things get tooooo big, but the items are very small so let's do this for now
  for await (const row of storeRows) {
    storeResults.push(row)
  }
  console.log(`Found ${storeResults.length} store rows`)
  await updateWithNewSpaceAndPutItems(storeClient, storeTableName, storeResults, newSpaceDid)

  const { client: uploadClient, tableName: uploadTableName } = getDynamoDb(
    'upload',
    W3UP_ENV,
    getRegion(W3UP_ENV)
  )

  const uploadRows = getAllTableRows(uploadClient, uploadTableName, oldSpaceDid)
  const uploadResults = []
  // this will run out of memory if things get tooooo big, but the items are very small so let's do this for now
  for await (const row of uploadRows) {
    uploadResults.push(row)
  }
  console.log(`Found ${uploadResults.length} upload rows`)
  await updateWithNewSpaceAndPutItems(uploadClient, uploadTableName, uploadResults, newSpaceDid)
}

/**
 * @template T
 * @param {Array<T>} arr
 * @param {number} chunkSize 
 * @yields {Array<T>}
 */
function* chunks(arr, chunkSize) {
  for (let i = 0; i < arr.length; i += chunkSize) {
    yield arr.slice(i, i + chunkSize);
  }
}

/**
 * @param {import('@aws-sdk/client-dynamodb').DynamoDBClient} dynamo
 * @param {string} tableName
 * @param {unknown[]} currentRows
 * @param {string} space
 * @param {object} [options]
 * @param {number} [options.limit]
 */
async function updateWithNewSpaceAndPutItems(dynamo, tableName, currentRows, space) {
  // max batch size is https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/dynamodb/command/BatchWriteItemCommand/
  const MAX_BATCH_SIZE = 25
  const updatedRows = currentRows.map(item => ({ ...item, space }))
  for (const rows of chunks(updatedRows, MAX_BATCH_SIZE)) {
    await dynamo.send(new BatchWriteItemCommand({
      RequestItems: {
        [tableName]: rows.slice(0, MAX_BATCH_SIZE).map(item => ({
          PutRequest: {
            Item: marshall(item)
          }
        }))
      }
    }))
  }
  console.log(`put ${currentRows.length} items to ${tableName}`)
}

/**
 * @param {import('@aws-sdk/client-dynamodb').DynamoDBClient} dynamo
 * @param {string} tableName
 * @param {string} space
 * @param {object} [options]
 * @param {number} [options.limit]
 */
async function* getAllTableRows(dynamo, tableName, space, options = {}) {
  let done = false
  let lastEvaluatedKey
  while (!done) {
    const response = await dynamo.send(new QueryCommand({
      TableName: tableName,
      Limit: options.limit || 100000,
      KeyConditions: {
        space: {
          ComparisonOperator: 'EQ',
          AttributeValueList: [{ S: space }],
        },
      },
      ExclusiveStartKey: lastEvaluatedKey
    }))
    for (const item of response.Items) {
      yield unmarshall(item)
    }
    if (response.LastEvaluatedKey) {
      lastEvaluatedKey = response.LastEvaluatedKey
    } else {
      done = true
    }
  }
}

/**
 * Get Env validating it is set.
 */
function getEnv() {
  return {
    W3UP_ENV: mustGetEnv('W3UP_ENV'),
  }
}

/**
 * 
 * @param {string} name 
 * @returns {string}
 */
function mustGetEnv(name) {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing env var: ${name}`)
  }

  return value
}

/**
 * @param {string} env
 */
function getRegion(env) {
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
function getDynamoDb(tableName, env, region) {
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
