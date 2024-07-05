import { createPieceTable } from '../filecoin/store/piece.js'
import { mustGetEnv } from '../lib/env.js'

export async function getOldestPiecesPendingDeals () {
  const {
    ENV,
  } = getEnv()

  const AWS_REGION = getRegion(ENV)
  const pieceTableName = getPieceTableName(ENV)
  const pieceStore = createPieceTable(AWS_REGION, pieceTableName)

  // query submitted status pieces (they are orderd by oldest timestamp with sort key)
  const submittedPieces = await pieceStore.query({
    status: 'submitted',
    
  })
  if (submittedPieces.error) {
    return {
      error: submittedPieces.error,
    }
  }

  // List first 10 entries
  console.log('10 oldest pieces pending deals')
  for (const piece of submittedPieces.ok.slice(0, 10)) {
    console.log(`${piece.piece.link()} at ${piece.insertedAt}`)
  }
}

/**
 * Get Env validating it is set.
 */
function getEnv() {
  return {
    ENV: mustGetEnv('ENV'),
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
 * @param {string} env
 */
function getPieceTableName (env) {
  if (env === 'staging') {
    return 'staging-w3infra-piece-v2'
  }

  return 'prod-w3infra-piece-v2'
}
