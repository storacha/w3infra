/** @typedef {import('@serverless-stack/resources').TableProps} TableProps */

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

/** @type TableProps */
export const delegationsTableProps = {
  fields: {
    cid: 'string',        // `baf...x`
    audience: 'string',   // `did:web:service`
    issuer: 'string',     // `did:key:agent`
    expiration: 'string', // `9256939505` (unix timestamp)
    insertedAt: 'string', // `2022-12-24T...`
    updatedAt: 'string',  // `2022-12-24T...`
  },
  // TODO does this index setup seem right?
  // we want to query by audience, but that won't necessarily be unique, so use cid as sortKey
  primaryIndex: { partitionKey: 'audience', sortKey: 'cid' },
}

/** @type TableProps */
export const provisionsTableProps = {
  fields: {
    cid: 'string',        // `baf...x` (CID of invocation that created this provision)
    consumer: 'string',   // `did:key:space` (DID of the actor that is consuming the provider, e.g. a space DID)
    provider: 'string',   // `did:web:service` (DID of the provider, e.g. a storage provider)
    sponsor: 'string',    // `did:key:agent` (DID of the actor that authorized this provision)
    insertedAt: 'string', // `2022-12-24T...`
    updatedAt: 'string',  // `2022-12-24T...`
  },
  // TODO do we need a sort key? cid should be sufficiently random to meet the criteria in https://aws.amazon.com/blogs/database/choosing-the-right-dynamodb-partition-key/ so maybe not?
  // TODO also are we sure that a single invocation will only create a single provision? the D1 schema used CID as a PRIMARY KEY so I think this should be fine, but will it always be true?
  primaryIndex: { partitionKey: 'cid' },
}