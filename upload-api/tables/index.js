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
export const delegationTableProps = {
  fields: {
    cause: 'string',      // `baf...x`(CID of the invocation)
    link: 'string',       // `baf...x` (CID of the delegation)
    audience: 'string',   // `did:web:service`
    issuer: 'string',     // `did:key:agent`
    expiration: 'string', // `9256939505` (unix timestamp)
    insertedAt: 'string', // `2022-12-24T...`
    updatedAt: 'string',  // `2022-12-24T...`
  },
  // TODO does this index setup seem right?
  // we want to query by audience, but that won't necessarily be unique, so use cid as sortKey
  primaryIndex: { partitionKey: 'audience', sortKey: 'link' },
}

/** @type TableProps */
export const subscriptionTableProps = {
  fields: {
    cause: 'string',        // `baf...x` (CID of invocation that created this subscription)
    provider: 'string',   // `did:web:service` (DID of the provider, e.g. a storage provider)
    customer: 'string',   // `did:mailto:agent` (DID of the user account)
    subscription: 'string',      // string (arbitrary string associated with this subscription)
    insertedAt: 'string', // `2022-12-24T...`
    updatedAt: 'string',  // `2022-12-24T...`
  },
  // TODO does this index setup seem right?
  primaryIndex: { partitionKey: 'customer', sortKey: 'subscription' },
  globalIndexes: {
    // TODO: I don't think we should keep this index - partitioning by provider is basically useless and won't be much faster than a table scan
    provider: { partitionKey: 'provider', projection: ['customer'] },
    subscription: { partitionKey: 'subscription', projection: ['customer'] }
  }
}

/** @type TableProps */
export const consumerTableProps = {
  fields: {
    cause: 'string',        // `baf...x` (CID of invocation that created this consumer record)
    consumer: 'string',   // `did:key:space` (DID of the actor that is consuming the provider, e.g. a space DID)
    provider: 'string',   // `did:web:service` (DID of the provider, e.g. a storage provider)
    subscription: 'string',      // string (arbitrary string associated with this subscription)
    insertedAt: 'string', // `2022-12-24T...`
    updatedAt: 'string',  // `2022-12-24T...`
  },
  // TODO does this index setup seem right?
  primaryIndex: { partitionKey: 'consumer', sortKey: 'subscription' },
  globalIndexes: {
    // TODO: I don't think we should keep this index - partitioning by provider is basically useless and won't be much faster than a table scan
    provider: { partitionKey: 'provider', projection: ['consumer'] }
  }
}