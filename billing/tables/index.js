/**
 * Stores customer details.
 *
 * @type {import('@serverless-stack/resources').TableProps}
 */
export const customerTableProps = {
  fields: {
    /** CID of the UCAN invocation that set it to the current value. */
    cause: 'string',
    /** DID of the user account e.g. `did:mailto:agent`. */
    customer: 'string',
    /**
     * Opaque identifier representing an account in the payment system
     * e.g. Stripe customer ID (stripe:cus_9s6XKzkNRiz8i3)
     */
    account: 'string',
    /** Unique identifier of the product a.k.a tier. */
    product: 'string',
    /** ISO timestamp record was inserted. */
    insertedAt: 'string',
    /** ISO timestamp record was updated. */
    updatedAt: 'string'
  },
  primaryIndex: { partitionKey: 'customer' }
}

/**
 * Stores snapshots of total space size at a given time.
 *
 * @type {import('@serverless-stack/resources').TableProps}
 */
export const spaceSizeSnapshotTableProps = {
  fields: {
    /** Space DID. */
    space: 'string',
    /** Total allocated size in bytes. */
    size: 'number',
    /** ISO timestamp allocation was snapshotted. */
    insertedAt: 'string'
  },
  primaryIndex: { partitionKey: 'space', sortKey: 'insertedAt' }
}

/**
 * Stores changes to total space size.
 *
 * @type {import('@serverless-stack/resources').TableProps}
 */
export const spaceSizeDiffTableProps = {
  fields: {
    /** Account DID (did:mailto:...). */
    account: 'string',
    /** Space DID (did:key:...). */
    space: 'string',
    /** Invocation CID that changed the space size (bafy...). */
    cause: 'string',
    /** Number of bytes added to or removed from the space. */
    change: 'number',
    /** ISO timestamp we recorded the change. */
    insertedAt: 'string'
  },
  primaryIndex: { partitionKey: 'account', sortKey: 'insertedAt' }
}
