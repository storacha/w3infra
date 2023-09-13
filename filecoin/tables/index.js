/** @typedef {import('@serverless-stack/resources').TableProps} TableProps */

/** @type TableProps */
export const pieceTableProps = {
  fields: {
    piece: 'string',        // `baga...1`
    link: 'string',         // `bagy...1`
    aggregate: 'string',    // `bagy...9`
    inclusion: 'string',    // TODO: Inclusion?
    insertedAt: 'string',   // `2022-12-24T...`
  },
  primaryIndex: { partitionKey: 'piece', sortKey: 'insertedAt' },
  globalIndexes: {
    link: { partitionKey: 'link', projection: 'all' }
  }
}
