/** @typedef {import('@serverless-stack/resources').TableProps} TableProps */

/** @type TableProps */
export const storeTableProps = {
  fields: {
    space: 'string',        // `did:key:space`
    link: 'string',         // `bagy...1`
  },
  // space + link must be unique to satisfy index constraint
  primaryIndex: { partitionKey: 'space', sortKey: 'link' },
}

/** @type TableProps */
export const uploadTableProps = {
  fields: {
    space: 'string',        // `did:key:space`
    root: 'string',         // `baf...x`
  },
  // space + root must be unique to satisfy index constraint
  primaryIndex: { partitionKey: 'space', sortKey: 'root' },
}
