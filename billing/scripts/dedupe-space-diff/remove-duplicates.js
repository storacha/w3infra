import all from 'p-all'
import path from 'path'
import fs from 'node:fs'
import dotenv from 'dotenv'
import parquetjs from '@dsnp/parquetjs'
import { BatchWriteItemCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb'

import { mustGetEnv } from '../../../lib/env.js'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'

dotenv.config({ path: '.env.local' })

/**
 * @typedef {object} ItemKey
 * @property {string} pk
 * @property {string} sk
 */

const STORACHA_ENV = mustGetEnv('STORACHA_ENV')
const SPACE_DIFF_TABLE_NAME = `${STORACHA_ENV}-w3infra-space-diff`

const BATCH_SIZE = 25
const MAX_RETRIES = 3
const concurrency = 5
const dynamo = new DynamoDBClient()

/**
 * @param {number} ms - Delay in milliseconds
 * @returns {Promise<void>}
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 *
 * @param {Object} params - The parameters for batch processing.
 * @param {ItemKey[]} params.items - The items to process.
 * @param {number} [params.retryCount=0] - The number of retry attempts.
 * @param {number} [params.delay=100] - The delay between retries in milliseconds.
 * @param {Object} [params.logContext={}] - Additional logging context.
 * @returns {Promise<void>} A promise that resolves when the batch is processed.
 */
async function processBatch({ items, retryCount = 0, delay = 100, logContext = {}}) {
  const deleteRequests = items.map((item) => ({
    DeleteRequest: {
      Key: marshall(item),
    },
  }))

  const batchDeleteCommand = new BatchWriteItemCommand({
    RequestItems: {
      [SPACE_DIFF_TABLE_NAME]: deleteRequests,
    },
  })

  try {
    const response = await dynamo.send(batchDeleteCommand)

    if (response.UnprocessedItems && response.UnprocessedItems[SPACE_DIFF_TABLE_NAME]) {
      const unprocessedItems = /** @type {ItemKey[]} */ (
        response.UnprocessedItems[SPACE_DIFF_TABLE_NAME].map((item) =>
          unmarshall(
            /** @type {Record<string, any>} */ (item.DeleteRequest?.Key)
          )
        )
      )
      if (retryCount < MAX_RETRIES) {
        console.log(`Retrying ${unprocessedItems.length} unprocessed items...`, logContext)
        await sleep(delay)
        return processBatch({
          items: unprocessedItems,
          retryCount: retryCount + 1,
          delay: delay * 2, // Increase delay exponentially
          logContext
        }
        )
      } else {
        console.error(
          `Max retries reached. Some items could not be processed: ${unprocessedItems}`,
           logContext
        )
      }
    }else{
      console.log(`Successfully deleted the entire batch!`, logContext)
    }
  } catch (err) {
    console.error('Failed to delete batch!', logContext, err)
  }
}

/**
 * @param {string} filePath
 * @returns {Promise<void>}
 */
async function processFile(filePath) {
  let reader = await parquetjs.ParquetReader.openFile(filePath)
  let cursor = reader.getCursor()

  /** @type {ItemKey[]} */
  let batch = []
  /** @type {(() => Promise<void>)[]} */
  const tasks = []
  const logContext = { file: filePath }

  let record = null
  while ((record = /** @type {ItemKey | null} */ (await cursor.next()))) {
    batch.push(record)
    if (batch.length == BATCH_SIZE) {
      const copyBatch = batch.slice()
      tasks.push(() => processBatch({ items: copyBatch, logContext }))
      batch = []
    }
  }
  if (batch.length > 0) {
    tasks.push(() => processBatch({ items: batch, logContext }))
  }

  await all(tasks, { concurrency })

  await reader.close()
}

export async function main() {
  const folderPath = process.argv[2]
  if (!fs.existsSync(folderPath)) {
    throw new Error(`Folder ${folderPath} does not exist!`)
  }

  const files = fs
    .readdirSync(folderPath)
    .filter((file) => file.endsWith('.parquet'))

  if (files.length == 0) {
    throw new Error('No relevant files found in the folder.')
  }

  let fileNumber = 0
  await all(
    files.map((file) => async () => {
      const filePath = path.join(folderPath, file)
      fileNumber++
      console.log(
        `\nProcessing file ${fileNumber}/${files.length}: ${filePath}`
      )
      await processFile(filePath)
    }),
    { concurrency }
  )
}

try {
  await main()
} catch (e) {
  console.error(e)
}
