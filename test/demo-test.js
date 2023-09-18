import dotenv from 'dotenv'

import { getDynamoDb } from './helpers/deployment.js'
import { setupNewClient } from './helpers/up-client.js'
import { randomFile } from './helpers/random.js'
import { pollQueryTable } from './helpers/table.js'

dotenv.config({ path: `.env.local`, override: true })

const pieceDynamo = getDynamoDb('piece')
const apiEndpoint = 'https://vasco.up.web3.storage'
const client = await setupNewClient(apiEndpoint)

const file = await randomFile(100)
const shards = []

// Upload new file
await client.uploadFile(file, {
  onShardStored: (meta) => {
    shards.push(meta.cid)
  }
})
console.log('uploaded CARs', shards.map(s => s))

const pieceEntries = await getPieces(pieceDynamo, shards[0].toString())

console.log('piece entries', pieceEntries)

/**
 * @param {any} context
 * @param {string} link
 */
async function getPieces (context, link) {
  const item = await pollQueryTable(
    context.client,
    context.tableName,
    {
      link: {
        ComparisonOperator: 'EQ',
        AttributeValueList: [{ S: link }]
      }
    },
    {
      indexName: 'link'
    }
  )

  return item
}
