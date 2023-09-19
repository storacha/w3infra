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
  globalIndexes: {
    cid: { partitionKey: 'link', sortKey: 'space', projection: ['space', 'insertedAt'] }
  }
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
  globalIndexes: {
    cid: { partitionKey: 'root', projection: ['space', 'insertedAt'] }
  }
}

/** @type TableProps */
export const delegationTableProps = {
  fields: {
    cause: 'string',      // `baf...x`(CID of the invocation)
    link: 'string',       // `baf...x` (CID of the delegation)
    audience: 'string',   // `did:web:service`
    issuer: 'string',     // `did:key:agent`
    expiration: 'number', // `9256939505` (unix timestamp in seconds)
    insertedAt: 'string', // `2022-12-24T...`
    updatedAt: 'string',  // `2022-12-24T...`
  },
  primaryIndex: { partitionKey: 'link' },
  globalIndexes: {
    audience: { partitionKey: 'audience', projection: ['link'] }
  }
}

/** @type TableProps */
export const subscriptionTableProps = {
  fields: {
    cause: 'string',        // `baf...x` (CID of invocation that created this subscription)
    provider: 'string',     // `did:web:service` (DID of the provider, e.g. a storage provider)
    customer: 'string',     // `did:mailto:agent` (DID of the user account)
    subscription: 'string', // string (arbitrary string associated with this subscription)
    insertedAt: 'string',   // `2022-12-24T...`
    updatedAt: 'string',    // `2022-12-24T...`
  },
  primaryIndex: { partitionKey: 'subscription', sortKey: 'provider' },
  globalIndexes: {
    customer: { partitionKey: 'customer', sortKey: 'provider', projection: ['cause', 'subscription'] },
    provider: { partitionKey: 'provider', projection: ['customer'] }
  }
}

/** @type TableProps */
export const consumerTableProps = {
  fields: {
    cause: 'string',        // `baf...x` (CID of invocation that created this consumer record)
    consumer: 'string',     // `did:key:space` (DID of the actor that is consuming the provider, e.g. a space DID)
    provider: 'string',     // `did:web:service` (DID of the provider, e.g. a storage provider)
    subscription: 'string', // string (arbitrary string associated with this subscription)
    insertedAt: 'string',   // `2022-12-24T...`
    updatedAt: 'string',    // `2022-12-24T...`
  },
  primaryIndex: { partitionKey: 'subscription', sortKey: 'provider' },
  globalIndexes: {
    consumer: { partitionKey: 'consumer', projection: ['provider', 'subscription'] },
    provider: { partitionKey: 'provider', projection: ['consumer'] }
  }
}

/** @type TableProps */
export const rateLimitTableProps = {
  fields: {
    id: 'string',           // arbitrary identifier for this limit
    cause: 'string',        // `baf...x` (CID of invocation that created record)
    subject: 'string',      // string (arbitrary string identifying the subject to be limited)
    rate: 'number',         // unitless number representing the rate to which the subject is limited
    insertedAt: 'string',   // `2022-12-24T...`
    updatedAt: 'string',    // `2022-12-24T...`
  },
  primaryIndex: { partitionKey: 'id' },
  globalIndexes: {
    subject: { partitionKey: 'subject', projection: ['rate', 'id'] },
  }
}