/** @typedef {import('sst/constructs').TableProps} TableProps */

/** @type TableProps */
export const storeTableProps = {
  fields: {
    space: 'string',        // `did:key:space`
    link: 'string',         // `bagy...1`
    size: 'number',         // `101`
    origin: 'string',       // `bagy...0` (prev CAR CID. optional)
    issuer: 'string',       // `did:key:agent` (issuer of ucan)
    invocation: 'string',   // `baf...ucan` (CID of invcation UCAN)
    insertedAt: 'string',   // `2022-12-24T...`
  },
  // space + link must be unique to satisfy index constraint
  primaryIndex: { partitionKey: 'space', sortKey: 'link' },
}

/** @type TableProps */
export const uploadTableProps = {
  fields: {
    space: 'string',        // `did:key:space`
    root: 'string',         // `baf...x`
    shard: 'string',        // `bagy...1
    insertedAt: 'string',   // `2022-12-24T...`
  },
  // space + root must be unique to satisfy index constraint
  primaryIndex: { partitionKey: 'space', sortKey: 'root' },
}
