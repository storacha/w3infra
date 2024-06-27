import {
  BatchWriteItemCommand,
  DynamoDBClient,
  PutItemCommand,
  QueryCommand
} from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'

/**
 * Read all upload and store rows and recalculate space metrics.
 * 
 * Race condition possible here - if someone adds something between the reads
 * and writes the metrics will be wrong - only run this when you're reasonably
 * sure nobody is uploading to the space.
 * 
 * @param {string} spaceDid 
 * @param {object} [options]
 * @param {boolean} [options.snapshot]
 */
export async function rebuildSpaceMetrics(spaceDid, options = {}) {
  let storeSize = 0
  let storeCount = 0
  const storeRows = tableRowsBySpace('store', spaceDid, { attributesToGet: ['size'] })
  for await (const row of storeRows) {
    storeCount++
    storeSize += row.size
  }

  let uploadCount = 0
  const uploadRows = tableRowsBySpace('upload', spaceDid)
  // eslint-disable-next-line no-unused-vars
  for await (const _ of uploadRows) {
    uploadCount++
  }

  console.log(`updating ${spaceDid} metrics with:
store count ${storeCount}
store size ${storeSize}
uploadCount ${uploadCount}`)
  await updateSpaceMetrics(spaceDid, storeCount, storeSize, uploadCount)

  if (options.snapshot) {
    console.log("new billing snapshot requested, creating...")
    await createNewBillingSnapshot(spaceDid, storeSize)
  }
}

function getProvider() {
  const {
    W3UP_ENV,
  } = getEnv()

  return W3UP_ENV === 'prod' ? 'did:web:web3.storage' : 'did:web:staging.web3.storage'
}

/**
 * 
 * @param {string} spaceDid 
 */
function getSnapshotPK(spaceDid) {

  return `${getProvider()}#${spaceDid}`
}

function startOfMonthDate() {
  const currentDate = new Date()
  return new Date(Date.UTC(currentDate.getUTCFullYear(), currentDate.getUTCMonth(), 1, 0, 0, 0))
}

/**
 * 
 * @param {string} spaceDid 
 * @param {number} storeSize 
 */
async function createNewBillingSnapshot(spaceDid, storeSize) {
  const {
    W3UP_ENV,
  } = getEnv()

  const { client: dynamo, tableName } = getDynamoDb(
    'space-snapshot',
    W3UP_ENV,
    getRegion(W3UP_ENV)
  )

  await dynamo.send(
    new PutItemCommand({
      TableName: tableName,
      Item: marshall({
        pk: getSnapshotPK(spaceDid),
        provider: getProvider(),
        space: spaceDid,
        size: storeSize,
        insertedAt: new Date().toISOString(),
        recordedAt: startOfMonthDate().toISOString()
      })
    })
  )
}

/**
 * 
 * @param {string} tableName 
 * @param {string} spaceDid 
 * @param {object} options 
 * @param {string[]} [options.attributesToGet]
 * @returns 
 */
function tableRowsBySpace(tableName, spaceDid, options = {}) {
  const {
    W3UP_ENV,
  } = getEnv()

  const { client, tableName: fullTableName } = getDynamoDb(
    tableName,
    W3UP_ENV,
    getRegion(W3UP_ENV)
  )

  return getAllTableRowsBySpace(client, fullTableName, spaceDid, options)
}

/**
 * 
 * @param {*} spaceDid 
 * @param {*} storeCount 
 * @param {*} storeSize 
 * @param {*} uploadCount 
 */
async function updateSpaceMetrics(spaceDid, storeCount, storeSize, uploadCount) {
  const {
    W3UP_ENV,
  } = getEnv()

  const { client: dynamo, tableName } = getDynamoDb(
    'space-metrics',
    W3UP_ENV,
    getRegion(W3UP_ENV)
  )

  await dynamo.send(new BatchWriteItemCommand({
    RequestItems: {
      [tableName]: [
        {
          PutRequest: {
            Item: marshall({
              space: spaceDid,
              name: 'store/add-size-total',
              value: storeSize
            })
          }
        },
        {
          PutRequest: {
            Item: marshall({
              space: spaceDid,
              name: 'store/add-total',
              value: storeCount
            })
          }
        },
        {
          PutRequest: {
            Item: marshall({
              space: spaceDid,
              name: 'upload/add-total',
              value: uploadCount
            })
          }
        },
      ]
    }
  }))
}

/**
 * @param {import('@aws-sdk/client-dynamodb').DynamoDBClient} dynamo
 * @param {string} tableName
 * @param {string} space
 * @param {object} [options]
 * @param {number} [options.limit]
 * @param {string[]} [options.attributesToGet]
 */
async function* getAllTableRowsBySpace(dynamo, tableName, space, options = {}) {
  let done = false
  let lastEvaluatedKey
  while (!done) {
    /**
     * @type {any}
     */
    const response = await dynamo.send(new QueryCommand({
      TableName: tableName,
      Limit: options.limit || 4000,
      AttributesToGet: options.attributesToGet,
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
