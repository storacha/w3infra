/** @typedef {import('@serverless-stack/resources').TableProps} TableProps */

/** @type TableProps */
export const pieceTableProps = {
  fields: {
    piece: 'string',        // `baga...1`
    content: 'string',      // `bagy...1`
    group: 'string',        // `did:web:free.web3.storage`
    stat: 'number',         // `0` as 'SUBMITTED' | `1` as 'ACCEPTED' | `2` as 'INVALID'
    insertedAt: 'string',   // `2022-12-24T...`
    updatedAt: 'string',   // `2022-12-24T...`
  },
  primaryIndex: { partitionKey: 'piece' },
  globalIndexes: {
    content: { partitionKey: 'content', projection: 'all' },
    stat: { partitionKey: 'stat', sortKey: 'insertedAt', projection: 'all' },
  }
}
