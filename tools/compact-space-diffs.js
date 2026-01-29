import { QueryCommand, BatchWriteItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
import { getDynamoClient } from '../lib/aws/dynamo.js'
import { mustGetEnv } from '../lib/env.js'
import { randomUUID } from 'crypto'
import { createConsumerStore } from '../billing/tables/consumer.js'
import { writeFileSync } from 'fs'
import path from 'path'
import * as Link from 'multiformats/link'
import { sha256 } from 'multiformats/hashes/sha2'
import * as raw from 'multiformats/codecs/raw'

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
 * Creates a simple progress bar for console output.
 *
 * @param {number} total - Total number of items
 * @param {string} label - Label for the progress bar
 * @returns {{ update: (value: number) => void, complete: () => void }} Progress bar object with update and complete methods
 */
function createProgressBar(total, label) {
  let current = 0
  const barLength = 40

  return {
    /**
     * Update progress bar
     *
     * @param {number} value - Current value
     */
    update: (value) => {
      current = value
      const percentage = Math.floor((current / total) * 100)
      const filled = Math.floor((current / total) * barLength)
      const empty = barLength - filled
      const bar = '█'.repeat(filled) + '░'.repeat(empty)
      process.stdout.write(`\r${label}: [${bar}] ${percentage}% (${current}/${total})`)
    },
    /**
     * Complete the progress bar
     */
    complete: () => {
      const bar = '█'.repeat(barLength)
      process.stdout.write(`\r${label}: [${bar}] 100% (${total}/${total})\n`)
    }
  }
}

/**
 * Compacts space diffs for a given space by creating a summation diff and archiving old diffs.
 *
 * @param {string} spaceDid - The space DID to compact
 * @param {{ ['previous-month']?: boolean }} [options] - Options for compaction
 */
export async function compactSpaceDiffs(spaceDid, options = {}) {
  console.log(options)
  try {
    const {
      ENV,
      DRY_RUN,
    } = getEnv()

    const SPACE_DID = spaceDid
    const PREVIOUS_MONTH = options['previous-month'] || false

    const region = getRegion(ENV)
    const dynamoDb = getDynamoClient({ region })
    const spaceDiffTableName = getSpaceDiffTableName(ENV)
    const spaceDiffArchiveTableName = getSpaceDiffArchiveTableName(ENV)
    const spaceSnapshotTableName = getSpaceSnapshotTableName(ENV)
    const consumerTableName = getConsumerTableName(ENV)

    if (DRY_RUN) {
      console.log('🔍 DRY RUN MODE - No records will be modified')
    }

    if (PREVIOUS_MONTH) {
      console.log('📅 PREVIOUS MONTH MODE - Compacting diffs between the two most recent snapshots')
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

  // Step 1: Get the most recent snapshot(s) for this space
  const pk = `${providerDID}#${SPACE_DID}`

  // Query for snapshots ordered by recordedAt (the sort key) in descending order
  // ScanIndexForward: false sorts by the sort key (recordedAt) descending, so newest first
  // Limit: 1 for current month, 2 for previous month mode
  const snapshotLimit = PREVIOUS_MONTH ? 2 : 1
  const snapshotResult = await dynamoDb.send(new QueryCommand({
    TableName: spaceSnapshotTableName,
    KeyConditionExpression: 'pk = :pk',
    ExpressionAttributeValues: {
      ':pk': { S: pk }
    },
    ScanIndexForward: false, // Sort by recordedAt descending (newest first)
    Limit: snapshotLimit
  }))

  let fromDate
  let toDate
  if (snapshotResult.Items && snapshotResult.Items.length > 0) {
    if (PREVIOUS_MONTH) {
      if (snapshotResult.Items.length < 2) {
        console.error('❌ ERROR: Previous month mode requires at least 2 snapshots')
        console.error('Only found 1 snapshot - cannot determine previous month period')
        return
      }
      const newerSnapshot = unmarshall(snapshotResult.Items[0])
      const olderSnapshot = unmarshall(snapshotResult.Items[1])
      fromDate = new Date(olderSnapshot.recordedAt)
      toDate = new Date(newerSnapshot.recordedAt)
      console.log(`Compacting previous month: ${fromDate.toISOString()} to ${toDate.toISOString()}`)
    } else {
      const snapshot = unmarshall(snapshotResult.Items[0])
      fromDate = new Date(snapshot.recordedAt)
      console.log(`Found most recent snapshot from: ${fromDate.toISOString()}`)
    }
  } else {
    console.error('❌ No snapshot found - compaction requires a snapshot to exist')
    console.error('Please run billing first to create a snapshot, then compact')
    return
  }

  // Step 2: Query all diffs in the time range
  console.log('Reading diffs from database...')
  const diffs = []
  /** @type {Record<string, import('@aws-sdk/client-dynamodb').AttributeValue> | undefined} */
  let exclusiveStartKey
  /** @type {import('@aws-sdk/client-dynamodb').QueryCommandOutput | undefined} */
  let queryResult
  let pageCount = 0

  do {
    // Build the query based on whether we have a toDate (previous month mode)
    /** @type {import('@aws-sdk/client-dynamodb').QueryCommandInput} */
    const queryInput = {
      TableName: spaceDiffTableName,
      ExclusiveStartKey: exclusiveStartKey
    }

    if (toDate) {
      // Previous month mode: query between two snapshots
      queryInput.KeyConditionExpression = 'pk = :pk AND sk BETWEEN :from AND :to'
      queryInput.ExpressionAttributeValues = {
        ':pk': { S: pk },
        ':from': { S: fromDate.toISOString() },
        ':to': { S: toDate.toISOString() }
      }
    } else {
      // Current month mode: query since last snapshot
      queryInput.KeyConditionExpression = 'pk = :pk AND sk >= :sk'
      queryInput.ExpressionAttributeValues = {
        ':pk': { S: pk },
        ':sk': { S: fromDate.toISOString() }
      }
    }

    queryResult = await dynamoDb.send(new QueryCommand(queryInput))

    if (queryResult.Items) {
      diffs.push(...queryResult.Items.map(/** @param {any} item */ item => unmarshall(item)))
      pageCount++
      process.stdout.write(`\rReading diffs: ${diffs.length} records (${pageCount} pages)...`)
    }

    exclusiveStartKey = queryResult.LastEvaluatedKey
  } while (exclusiveStartKey)

  console.log(`\n✓ Found ${diffs.length} diffs to compact`)

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
  const syntheticUUID = randomUUID()

  // Convert UUID to bytes and create a CID from it
  const uuidBytes = new TextEncoder().encode(syntheticUUID)
  const hash = await sha256.digest(uuidBytes)
  const syntheticCauseCID = Link.create(raw.code, hash)

  const summationReceiptAt = lastReceiptAt
  const summationDiffSk = `${summationReceiptAt.toISOString()}#${syntheticCauseCID.toString()}`

  const summationDiff = {
    pk,
    sk: summationDiffSk,
    space: SPACE_DID,
    provider: providerDID,
    subscription,
    cause: syntheticCauseCID.toString(),
    delta: totalDelta,
    receiptAt: summationReceiptAt.toISOString(),
    insertedAt: new Date().toISOString()
  }

  console.log(`Creating summation diff with sk: ${summationDiffSk}`)

  if (!DRY_RUN) {
    // Step 5: Write the summation diff to the space-diff table
    await dynamoDb.send(new PutItemCommand({
      TableName: spaceDiffTableName,
      Item: marshall(summationDiff, { removeUndefinedValues: true })
    }))
    console.log('✓ Summation diff created')

    // Step 6: Move original diffs to archive table in batches
    const archiveBatches = []
    for (let i = 0; i < diffs.length; i += 25) {
      archiveBatches.push(diffs.slice(i, i + 25))
    }

    const archiveProgress = createProgressBar(diffs.length, 'Archiving diffs')
    let archivedCount = 0

    for (const batch of archiveBatches) {
      const archiveWrites = batch.map(diff => ({
        PutRequest: {
          Item: marshall({
            ...diff,
            summationDiffSk
          }, { removeUndefinedValues: true })
        }
      }))

      const response = await dynamoDb.send(new BatchWriteItemCommand({
        RequestItems: {
          [spaceDiffArchiveTableName]: archiveWrites
        }
      }))

      // Retry unprocessed items once
      if (response.UnprocessedItems && Object.keys(response.UnprocessedItems).length > 0) {
        console.log(`\nRetrying ${response.UnprocessedItems[spaceDiffArchiveTableName]?.length || 0} unprocessed archive items...`)
        const retryResponse = await dynamoDb.send(new BatchWriteItemCommand({
          RequestItems: response.UnprocessedItems
        }))

        if (retryResponse.UnprocessedItems && Object.keys(retryResponse.UnprocessedItems).length > 0) {
          const unprocessedCount = retryResponse.UnprocessedItems[spaceDiffArchiveTableName]?.length || 0
          console.error('\n❌ CRITICAL ERROR: Failed to archive all diffs after retry')
          console.error(`${unprocessedCount} items could not be archived`)
          console.error('The compaction is incomplete - some diffs may not be properly archived!')
          const error = new Error(`Failed to archive ${unprocessedCount} items after retry`)
          logError('Failed to archive all diffs to space-diff-archive table', error)
          throw error
        }
      }

      archivedCount += batch.length
      archiveProgress.update(archivedCount)
    }
    archiveProgress.complete()

    // Step 7: Delete original diffs from space-diff table in batches
    const deleteBatches = []
    for (let i = 0; i < diffs.length; i += 25) {
      deleteBatches.push(diffs.slice(i, i + 25))
    }

    const deleteProgress = createProgressBar(diffs.length, 'Deleting original diffs')
    let deletedCount = 0

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

        const response = await dynamoDb.send(new BatchWriteItemCommand({
          RequestItems: {
            [spaceDiffTableName]: deleteWrites
          }
        }))

        // Retry unprocessed items once
        if (response.UnprocessedItems && Object.keys(response.UnprocessedItems).length > 0) {
          console.log(`\nRetrying ${response.UnprocessedItems[spaceDiffTableName]?.length || 0} unprocessed delete items...`)
          const retryResponse = await dynamoDb.send(new BatchWriteItemCommand({
            RequestItems: response.UnprocessedItems
          }))

          if (retryResponse.UnprocessedItems && Object.keys(retryResponse.UnprocessedItems).length > 0) {
            const unprocessedCount = retryResponse.UnprocessedItems[spaceDiffTableName]?.length || 0
            console.error('\n❌ CRITICAL ERROR: Failed to delete all original diffs after retry')
            console.error(`${unprocessedCount} items could not be deleted from the space-diff table`)
            console.error('⚠️  WARNING: These diffs have been archived but NOT removed from the main table!')
            console.error('⚠️  This WILL result in double-charging for usage!')
            console.error('⚠️  Manual cleanup is REQUIRED immediately!')
            const error = new Error(`Failed to delete ${unprocessedCount} items after retry`)
            logError('Failed to delete all original diffs from space-diff table after retry', error)
            throw error
          }
        }

        deletedCount += batch.length
        deleteProgress.update(deletedCount)
      }
      deleteProgress.complete()
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
