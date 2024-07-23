import { createPieceTable } from '../filecoin/store/piece.js'
import { getPieceTableName, getRegion, getStage } from './lib.js'

export async function getOldestPiecesPendingDeals () {
  const stage = getStage()
  const region = getRegion(stage)
  const pieceTableName = getPieceTableName(stage)
  const pieceStore = createPieceTable(region, pieceTableName)

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
