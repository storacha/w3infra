import { test } from './helpers/context.js'

import { PutObjectCommand } from '@aws-sdk/client-s3'

import { createS3, createBucket, createDynamodDb } from './helpers/resources.js'
import { createDynamoTable, getItemsFromTable } from './helpers/tables.js'
import { createCar } from './helpers/car.js'

import { computePieceCid } from '../index.js'
import { pieceTableProps } from '../store/index.js'
import { createPieceTable } from '../store/piece.js'

const AWS_REGION = 'us-west-2'

test.before(async t => {
  // S3
  const { client, stop: s3Stop } = await createS3({ port: 9000 })
  // DynamoDB
  const {
    client: dynamoClient,
    endpoint: dbEndpoint,
    stop: dynamoStop
  } = await createDynamodDb({ port: 8000 })

  Object.assign(t.context, {
    s3Client: client,
    dbEndpoint,
    dynamoClient,
    stop: async () => {
      await s3Stop()
      await dynamoStop()
    }
  })
})

test.after(async t => {
  await t.context.stop()
})

test('computes piece CID from a CAR file in the bucket', async t => {
  const { tableName, bucketName } = await prepareResources(t.context.dynamoClient, t.context.s3Client)
  const { body, checksum, key, piece, link } = await createCar()
  const pieceTable = createPieceTable(AWS_REGION, tableName, {
    endpoint: t.context.dbEndpoint
  })

  await t.context.s3Client.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: body,
      ChecksumSHA256: checksum,
    })
  )
  const group = 'this-group'
  const record = {
    bucketName,
    bucketRegion: 'us-west-2',
    key,
  }

  const { ok, error } = await computePieceCid({
    record,
    s3Client: t.context.s3Client,
    pieceTable,
    group
  })
  t.truthy(ok)
  t.falsy(error)

  const storedItems = await getItemsFromTable(t.context.dynamoClient, tableName, {
    content: {
      ComparisonOperator: 'EQ',
      AttributeValueList: [{ S: link.toString() }]
    }
  }, {
    indexName: 'content'
  })

  t.truthy(storedItems)
  t.is(storedItems?.length, 1)
  t.is(storedItems?.[0].piece, piece.toString())
  t.is(storedItems?.[0].group, group)
})

/**
 * @param {import('@aws-sdk/client-dynamodb').DynamoDBClient} dynamoClient
 * @param {import("@aws-sdk/client-s3").S3Client} s3Client
 */
async function prepareResources (dynamoClient, s3Client) {
  const [ tableName, bucketName ] = await Promise.all([
    createDynamoTable(dynamoClient, pieceTableProps),
    createBucket(s3Client)
  ])

  return {
    tableName,
    bucketName
  }
}
