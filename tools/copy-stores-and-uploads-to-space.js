import {
  BatchWriteItemCommand,
  DynamoDBClient,
  QueryCommand
} from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'

export async function copyStoresAndUploadsToNewSpace() {
  const {
    ENV,
    OLD_SPACE_DID,
    NEW_SPACE_DID
  } = getEnv()

  const { client: storeClient, tableName: storeTableName } = getDynamoDb(
    'store',
    ENV,
    getRegion(ENV)
  )

  const storeRows = getAllTableRows(storeClient, storeTableName, OLD_SPACE_DID)
  const storeResults = []
  // this will run out of memory if things get tooooo big, but the items are very small so let's do this for now
  for await (const row of storeRows) {
    storeResults.push(row)
  }
  console.log(`Found ${storeResults.length} store rows`)
  await updateWithNewSpaceAndPutItems(storeClient, storeTableName, storeResults, NEW_SPACE_DID)

  const { client: uploadClient, tableName: uploadTableName } = getDynamoDb(
    'upload',
    ENV,
    getRegion(ENV)
  )

  const uploadRows = getAllTableRows(uploadClient, uploadTableName, OLD_SPACE_DID)
  const uploadResults = []
  // this will run out of memory if things get tooooo big, but the items are very small so let's do this for now
  for await (const row of uploadRows) {
    uploadResults.push(row)
  }
  console.log(`Found ${uploadResults.length} upload rows`)
  await updateWithNewSpaceAndPutItems(uploadClient, uploadTableName, uploadResults, NEW_SPACE_DID)
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
export async function updateWithNewSpaceAndPutItems(dynamo, tableName, currentRows, space) {
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
export async function* getAllTableRows(dynamo, tableName, space, options = {}) {
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
    ENV: mustGetEnv('ENV'),
    OLD_SPACE_DID: mustGetEnv('OLD_SPACE_DID'),
    NEW_SPACE_DID: mustGetEnv('NEW_SPACE_DID'),
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

await copyStoresAndUploadsToNewSpace()