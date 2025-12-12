import { mustGetEnv } from '../lib/env.js'
import { decodeRecord } from '../filecoin/store/piece.js'
import { Storefront } from '@storacha/filecoin-client'
import { getServiceSigner, getServiceConnection } from '../filecoin/service.js'
import { DynamoDBClient,QueryCommand } from '@aws-sdk/client-dynamodb'
import { unmarshall } from '@aws-sdk/util-dynamodb'

/**
 * Invoke filecoin/submit on the storefront service for pieces older than a cutoff date.
 * This is useful for recovering from situations where pieces were submitted but never processed.
 *
 * @param {object} [options]
 * @param {string} [options.cutoffDate] - ISO date string. If not provided, uses CUTOFF_DATE env var
 */
export async function reFilecoinSubmitPieces (options = {}) {
  console.log('Starting re-filecoin/submit process for old pieces...')

  const {
    env,
    awsRegion,
    pieceTableName,
    storefrontDid,
    storefrontUrl,
    privateKey,
    cutoffDate
  } = getConfig(options)

  console.log(`Environment: ${env}`)
  console.log(`AWS region: ${awsRegion}`)
  console.log(`Piece table: ${pieceTableName}`)
  console.log(`Cutoff date: ${cutoffDate}`)
  console.log(`Storefront DID: ${storefrontDid}`)
  console.log(`Storefront URL: ${storefrontUrl}`)
  console.log('')

  const dynamoDb = new DynamoDBClient({
    region: awsRegion,
  })

  // Setup: create storefront service context
  const storefrontSigner = getServiceSigner({
    did: storefrontDid,
    privateKey
  })
  const connection = getServiceConnection({
    did: storefrontDid,
    url: storefrontUrl
  })
  const context = {
    storefrontService: {
      connection,
      invocationConfig: {
        issuer: storefrontSigner,
        with: storefrontSigner.did(),
        audience: storefrontSigner,
      },
    },
  }

  // Query and process pieces page by page
  console.log('Querying pieces with status=submitted (stat=0) and insertedAt <= cutoff date...')

  let cursor
  let totalProcessed = 0
  let successCount = 0
  let errorCount = 0

  do {
    // Fetch a page of pieces
    const fetchResult = await fetchPiecesPage(
      dynamoDb,
      pieceTableName,
      cutoffDate,
      cursor
    )

    if (fetchResult.error) {
      throw fetchResult.error
    }

    const pieces = fetchResult.ok.pieces
    cursor = fetchResult.ok.cursor

    console.log(`Retrieved ${pieces.length} pieces (total so far: ${totalProcessed + pieces.length})`)

    if (pieces.length === 0) {
      break
    }

    // Process this page of pieces
    const processResult = await filecoinSubmitPieces(context, pieces, totalProcessed)
    successCount += processResult.successCount
    errorCount += processResult.errorCount
    totalProcessed += pieces.length

  } while (cursor)

  console.log(`\nFound ${totalProcessed} pieces to re-submit\n`)

  if (totalProcessed === 0) {
    console.log('No pieces to process')
    return
  }

  console.log('\nRe-filecoin/submission complete!')
  console.log(`Successfully submitted: ${successCount}`)
  console.log(`Failed: ${errorCount}`)
  console.log(`Total processed: ${totalProcessed}`)
}

/**
 * Fetch a page of pieces with status=submitted and insertedAt <= cutoffDate.
 *
 * @param {import('@aws-sdk/client-dynamodb').DynamoDBClient} dynamoDb
 * @param {string} tableName
 * @param {string} cutoffDate
 * @param {string} [cursor]
 */
async function fetchPiecesPage(dynamoDb, tableName, cutoffDate, cursor) {
  const queryCmd = new QueryCommand({
    TableName: tableName,
    IndexName: 'stat',
    KeyConditionExpression: 'stat = :stat AND insertedAt <= :cutoffDate',
    ExpressionAttributeValues: {
      ':stat': { N: '0' },
      ':cutoffDate': { S: cutoffDate }
    },
    ExclusiveStartKey: cursor ? JSON.parse(cursor) : undefined,
    Limit: 100
  })

  try {
    const res = await dynamoDb.send(queryCmd)

    return {
      ok: {
        pieces: (res.Items ?? []).map(item => decodeRecord(
          /** @type {import('../filecoin/types.js').PieceStoreRecord} */ (unmarshall(item))
        )),
        cursor: res.LastEvaluatedKey ? JSON.stringify(res.LastEvaluatedKey) : undefined
      }
    }
  } catch (/** @type {any} */ error) {
    console.error(error)
    return {
      error: new Error(`Failed to query pieces: ${error.message}`)
    }
  }
}

/**
 * Submit a batch of pieces to the storefront service.
 *
 * @param {import('@storacha/filecoin-api/storefront/api').StorefrontClientContext} context
 * @param {import('@storacha/filecoin-api/storefront/api').PieceRecord[]} pieces
 * @param {number} startIndex - The index of the first piece in this batch (for logging)
 */
async function filecoinSubmitPieces(context, pieces, startIndex) {
  let successCount = 0
  let errorCount = 0

  console.log('Starting to re-submit pieces...')

  for (let i = 0; i < pieces.length; i++) {
    const piece = pieces[i]
    const pieceNumber = startIndex + i + 1

    if (pieceNumber % 10 === 0 || pieceNumber === 1) {
      console.log(`Processing piece ${pieceNumber}...`)
    }

    try {
      const filecoinSubmitInv = await Storefront.filecoinSubmit(
        context.storefrontService.invocationConfig,
        piece.content,
        piece.piece,
        { connection: context.storefrontService.connection }
      )

      if (filecoinSubmitInv.out.error) {
        console.error(`  Error submitting piece ${piece.piece.toString()}: ${filecoinSubmitInv.out.error.message}`)
        errorCount++
      } else {
        successCount++
      }
    } catch (error) {
      console.error(`  Exception submitting piece ${piece.piece.toString()}:`, error)
      errorCount++
    }
  }

  return { successCount, errorCount }
}

/**
 * Get config based on environment variables.
 *
 * @param {object} [options]
 * @param {string} [options.cutoffDate]
 */
function getConfig(options = {}) {
  const env = mustGetEnv('ENV')
  const privateKey = mustGetEnv('PRIVATE_KEY')
  const cutoffDate = options.cutoffDate || mustGetEnv('CUTOFF_DATE')

  let awsRegion
  let pieceTableName
  let storefrontDid
  let storefrontUrl

  switch (env) {
    case 'prod': {
      awsRegion = 'us-west-2'
      pieceTableName = 'prod-w3infra-piece-v2'
      storefrontDid = 'did:web:up.storacha.network'
      storefrontUrl = 'https://up.storacha.network'
      break
    }
    case 'staging': {
      awsRegion = 'us-east-2'
      pieceTableName = 'staging-w3infra-piece-v2'
      storefrontDid = 'did:web:staging.up.storacha.network'
      storefrontUrl = 'https://staging.up.storacha.network'
      break
    }
    case 'forge-prod': {
      awsRegion = 'us-west-2'
      pieceTableName = 'forge-prod-upload-api-piece-v2'
      storefrontDid = 'did:web:up.forge.storacha.network'
      storefrontUrl = 'https://up.forge.storacha.network'
      break
    }
    case 'staging-warm': {
      awsRegion = 'us-east-2'
      pieceTableName = 'staging-warm-upload-api-piece-v2'
      storefrontDid = 'did:web:staging.up.warm.storacha.network'
      storefrontUrl = 'https://staging.up.warm.storacha.network'
      break
    }
    default: {
      throw new Error(`Invalid env: ${env}`)
    }
  }

  return {
    env,
    privateKey,
    cutoffDate,
    awsRegion,
    pieceTableName,
    storefrontDid,
    storefrontUrl,
  }
}
