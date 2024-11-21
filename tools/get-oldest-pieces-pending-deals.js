import { createPieceTable } from '../filecoin/store/piece.js'
import { getPieceTableName, getRegion, getStage } from './lib.js'

const defaultMax = 10

export async function getOldestPiecesPendingDeals () {
  const stage = getStage()
  const region = getRegion(stage)
  const pieceTableName = getPieceTableName(stage)
  const pieceStore = createPieceTable(region, pieceTableName)

  let max = process.argv[3] ? parseInt(process.argv[3]) : defaultMax
  max = isNaN(max) ? defaultMax : max

  console.log(`${max.toLocaleString()} oldest pieces pending deals`)
  let total = 0
  let cursor
  while (true) {
    // query submitted status pieces (they are orderd by oldest timestamp with sort key)
    const submittedPieces = await pieceStore.query({
      status: 'submitted',
    }, {
      cursor,
      size: Math.min(max, 1000)
    })
    if (submittedPieces.error) {
      return {
        error: submittedPieces.error,
      }
    }

    for (const piece of submittedPieces.ok.results) {
      console.log(`${piece.piece.link()} at ${piece.insertedAt}`)
      total++
      if (total >= max) break
    }
    cursor = submittedPieces.ok.cursor
    if (!cursor || total >= max) break
  }
  console.log(`Total: ${total}`)
}
