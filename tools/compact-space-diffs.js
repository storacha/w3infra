import { QueryCommand, BatchWriteItemCommand } from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
import { getDynamoClient } from '../lib/aws/dynamo.js'
import { mustGetEnv } from '../lib/env.js'
import { randomUUID } from 'crypto'
import { createConsumerStore } from '../billing/tables/consumer.js'
import { writeFileSync } from 'fs'
import path from 'path'

/**
 * Logs an error message and details to a timestamped file.
 *
 * @param {string} message - The error message
 * @param {Error} error - The error object
 */
function logError(message, error) {
  const errorLogPath = path.join(process.cwd(), `compact-errors-${Date.now()}.log`)
  const errorDetails = `${new Date().toISOString()} - ${message}\n\nError: ${error.message}\n\nStack:\n${error.stack}\n`

  try {
    writeFileSync(errorLogPath, errorDetails)
    console.error(`Error details written to: ${errorLogPath}`)
  } catch (writeError) {
    console.error('Failed to write error log file:', writeError)
  }
}

/**
 * Compacts space diffs for a given space by creating a summation diff and archiving old diffs.
 *
 * @param {string} spaceDid - The space DID to compact
 */
export async function compactSpaceDiffs(spaceDid) {
  try {
    const {
      ENV,
      DRY_RUN,
    } = getEnv()

    const SPACE_DID = spaceDid

    const region = getRegion(ENV)
    const dynamoDb = getDynamoClient({ region })
    const spaceDiffTableName = getSpaceDiffTableName(ENV)
    const spaceDiffArchiveTableName = getSpaceDiffArchiveTableName(ENV)
    const spaceSnapshotTableName = getSpaceSnapshotTableName(ENV)
    const consumerTableName = getConsumerTableName(ENV)

    if (DRY_RUN) {
      console.log('🔍 DRY RUN MODE - No records will be modified')
    }

    console.log(`Compacting space diffs for space: ${SPACE_DID}`)

    // Look up the provider from the consumer table
    const consumerStore = createConsumerStore({ region }, { tableName: consumerTableName })
    const consumerListResult = await consumerStore.list({ consumer: /** @type {import('@ucanto/interface').DID} */ (SPACE_DID) })

    if (consumerListResult.error) {
      console.error('❌ ERROR: Failed to look up consumer for space:', consumerListResult.error)
      const error = new Error(`Failed to look up consumer: ${consumerListResult.error.message}`)
      logError('Failed to look up consumer for space', error)
      throw error
    }

    if (consumerListResult.ok.results.length === 0) {
      console.error('❌ ERROR: No consumer found for space:', SPACE_DID)
      console.error('This space may not have any subscriptions')
      const error = new Error('No consumer found for space')
      logError('No consumer found for space', error)
      throw error
    }

  // Use the first consumer's provider (there should typically be only one)
  const providerDID = consumerListResult.ok.results[0].provider
  console.log(`Found provider for space: ${providerDID}`)

  // Step 1: Get the most recent snapshot for this space
  const pk = `${providerDID}#${SPACE_DID}`

  // Query for snapshots ordered by recordedAt (the sort key) in descending order
  // ScanIndexForward: false sorts by the sort key (recordedAt) descending, so newest first
  // Limit: 1 returns only the most recent snapshot
  const snapshotResult = await dynamoDb.send(new QueryCommand({
    TableName: spaceSnapshotTableName,
    KeyConditionExpression: 'pk = :pk',
    ExpressionAttributeValues: {
      ':pk': { S: pk }
    },
    ScanIndexForward: false, // Sort by recordedAt descending (newest first)
    Limit: 1
  }))

  let fromDate
  if (snapshotResult.Items && snapshotResult.Items.length > 0) {
    const snapshot = unmarshall(snapshotResult.Items[0])
    fromDate = new Date(snapshot.recordedAt)
    console.log(`Found most recent snapshot from: ${fromDate.toISOString()}`)
  } else {
    console.error('❌ No snapshot found - compaction requires a snapshot to exist')
    console.error('Please run billing first to create a snapshot, then compact')
    return
  }

  // Step 2: Query all diffs since the snapshot
  const diffs = []
  /** @type {Record<string, import('@aws-sdk/client-dynamodb').AttributeValue> | undefined} */
  let exclusiveStartKey
  /** @type {import('@aws-sdk/client-dynamodb').QueryCommandOutput | undefined} */
  let queryResult

  do {
    queryResult = await dynamoDb.send(new QueryCommand({
      TableName: spaceDiffTableName,
      KeyConditionExpression: 'pk = :pk AND sk >= :sk',
      ExpressionAttributeValues: {
        ':pk': { S: pk },
        ':sk': { S: fromDate.toISOString() }
      },
      ExclusiveStartKey: exclusiveStartKey
    }))

    if (queryResult.Items) {
      diffs.push(...queryResult.Items.map(/** @param {any} item */ item => unmarshall(item)))
    }

    exclusiveStartKey = queryResult.LastEvaluatedKey
  } while (exclusiveStartKey)

  console.log(`Found ${diffs.length} diffs to compact`)

  if (diffs.length === 0) {
    console.log('No diffs to compact')
    return
  }

  // Step 3: Calculate the summation
  const totalDelta = diffs.reduce((sum, diff) => sum + diff.delta, 0)
  console.log(`Total delta: ${totalDelta} bytes`)


  // Find the most recent receiptAt from all diffs to be compacted
  const mostRecentDiff = diffs.reduce((latest, diff) =>
    new Date(diff.receiptAt) > new Date(latest.receiptAt) ? diff : latest
  )
  const lastReceiptAt = new Date(mostRecentDiff.receiptAt)
  console.log(`Most recent diff receipt date: ${lastReceiptAt.toISOString()}`)
  
  // use the subscription from the most recent diff (they will usually all be the same)
  const subscription = mostRecentDiff.subscription

  // Step 4: Create a summation diff with a synthetic UUID cause
  // IMPORTANT: Use the last receipt date to accurately represent when the final diff occurred
  const syntheticCause = randomUUID()
  const summationReceiptAt = lastReceiptAt
  const summationDiffSk = `${summationReceiptAt.toISOString()}#${syntheticCause}`

  const summationDiff = {
    pk,
    sk: summationDiffSk,
    space: SPACE_DID,
    provider: providerDID,
    subscription,
    cause: syntheticCause,
    delta: totalDelta,
    receiptAt: summationReceiptAt.toISOString(),
    insertedAt: new Date().toISOString()
  }

  console.log(`Creating summation diff with sk: ${summationDiffSk}`)

  if (!DRY_RUN) {
    // Step 5: Write the summation diff to the space-diff table
    await dynamoDb.send(new BatchWriteItemCommand({
      RequestItems: {
        [spaceDiffTableName]: [{
          PutRequest: {
            Item: marshall(summationDiff, { removeUndefinedValues: true })
          }
        }]
      }
    }))
    console.log('✓ Summation diff created')

    // Step 6: Move original diffs to archive table in batches
    const archiveBatches = []
    for (let i = 0; i < diffs.length; i += 25) {
      archiveBatches.push(diffs.slice(i, i + 25))
    }

    for (const batch of archiveBatches) {
      const archiveWrites = batch.map(diff => ({
        PutRequest: {
          Item: marshall({
            ...diff,
            summationDiffSk
          }, { removeUndefinedValues: true })
        }
      }))

      await dynamoDb.send(new BatchWriteItemCommand({
        RequestItems: {
          [spaceDiffArchiveTableName]: archiveWrites
        }
      }))
    }
    console.log(`✓ Archived ${diffs.length} diffs`)

    // Step 7: Delete original diffs from space-diff table in batches
    const deleteBatches = []
    for (let i = 0; i < diffs.length; i += 25) {
      deleteBatches.push(diffs.slice(i, i + 25))
    }

    try {
      for (const batch of deleteBatches) {
        const deleteWrites = batch.map(diff => ({
          DeleteRequest: {
            Key: marshall({
              pk: diff.pk,
              sk: diff.sk
            })
          }
        }))

        await dynamoDb.send(new BatchWriteItemCommand({
          RequestItems: {
            [spaceDiffTableName]: deleteWrites
          }
        }))
      }
      console.log(`✓ Deleted ${diffs.length} original diffs`)
    } catch (/** @type {any} */ error) {
      console.error('❌ ERROR: Failed to delete original diffs from space-diff table')
      console.error('This is a critical error - the diffs have been archived but not removed from the main table. This could result in the user being double charged for usage!')
      console.error('Manual cleanup may be required')
      console.error('Error details:', error.message)
      logError('Failed to delete original diffs from space-diff table', error)
      throw error
    }
  } else {
    console.log(`[DRY RUN] Would create summation diff: ${JSON.stringify(summationDiff, null, 2)}`)
    console.log(`[DRY RUN] Would archive ${diffs.length} diffs`)
    console.log(`[DRY RUN] Would delete ${diffs.length} original diffs`)
  }

  console.log('✅ Compaction complete')
  } catch (/** @type {any} */ error) {
    // Log any uncaught errors
    if (!error.logged) {
      logError('Compaction failed with unexpected error', error)
    }
    throw error
  }
}

/**
 * Get Env validating it is set.
 */
function getEnv() {
  return {
    ENV: mustGetEnv('ENV'),
    DRY_RUN: process.env.DRY_RUN !== 'false',
  }
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
 * @param {string} env
 */
function getSpaceDiffTableName(env) {
  return `${env}-w3infra-space-diff`
}

/**
 * @param {string} env
 */
function getSpaceDiffArchiveTableName(env) {
  return `${env}-w3infra-space-diff-archive`
}

/**
 * @param {string} env
 */
function getSpaceSnapshotTableName(env) {
  return `${env}-w3infra-space-snapshot`
}

/**
 * @param {string} env
 */
function getConsumerTableName(env) {
  return `${env}-w3infra-consumer`
}
