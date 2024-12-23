import fs from 'node:fs'
import dotenv from 'dotenv'
import parse from 'csv-parser'
import {
  DynamoDBClient,
  TransactWriteItemsCommand,
} from '@aws-sdk/client-dynamodb'

import { mustGetEnv } from '../../../lib/env.js'

/**
 * @typedef {object} ParsedSnapshot
 * @property {string} provider - Storage provider this snapshot refers to.
 * @property {string} space - Space this snapshot refers to.
 * @property {string} size - Total allocated size in bytes, as a string.
 * @property {string} recordedAt - ISO string representing the recorded timestamp.
 * @property {string} insertedAt - ISO string representing the insertion timestamp.
 */

dotenv.config({ path: '.env.local' })

const SPACE_SNAPSHOT_TABLE_NAME = mustGetEnv('SPACE_SNAPSHOT_TABLE_NAME')

const args = process.argv.slice(2)
const filename = args[0] // TODO: validate

const dynamo = new DynamoDBClient()

export async function main() {
  /** @type ParsedSnapshot[]} */
  const snapshots = await readCsvInput(filename)

  /** @type {import('@aws-sdk/client-dynamodb').TransactWriteItem[]} */
  const transactItems = []
  for (const snap of snapshots) {
    transactItems.push({
      Put: {
        // NOTE: This operation will create a new item if it doesn't exist, or overwrite the item if it does.
        TableName: SPACE_SNAPSHOT_TABLE_NAME,
        Item: {
          pk: { S: `${snap.provider}#${snap.space}` },
          recordedAt: { S: snap.recordedAt },
          insertedAt: { S: snap.insertedAt },
          provider: { S: snap.provider },
          size: { N: snap.size },
          space: { S: snap.space },
        },
      },
    })
  }

  /** @type {import('@aws-sdk/client-dynamodb').TransactWriteItemsCommandInput} */
  const transactWriteParams = { TransactItems: transactItems }

  try {
    const command = new TransactWriteItemsCommand(transactWriteParams)
    const response = await dynamo.send(command)
    console.log(response)
  } catch (err) {
    console.error('Failed to update or create snapshot!', err)
  }
}

try {
  await main()
} catch (e) {
  console.error(e)
}

/**
 * @param {string} filename
 * @returns {Promise<any[]>}
 */
function readCsvInput(filename) {
  return new Promise((resolve, reject) => {
    /** @type any[] */
    const data = []
    fs.createReadStream(filename, { encoding: 'utf8' })
      .pipe(parse())
      .on('data', (row) => {
        data.push(row)
      })
      .on('error', (error) => {
        reject(new Error('Error reading input file!', { cause: error }))
      })
      .on('end', () => {
        console.log('Finished reading input file!')
        resolve(data)
      })
  })
}
