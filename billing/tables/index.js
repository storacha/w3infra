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
     * Opaque identifier representing an account in the payment system.
     *
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
export const spaceSnapshotTableProps = {
  fields: {
    /**
     * CSV Space DID and Provider DID.
     *
     * e.g. did:key:z6Mksjp3Mbe7TnQbYK43NECF7TRuDGZu9xdzeLg379Dw66mF,did:web:web3.storage
     */
    space: 'string',
    /** Total allocated size in bytes. */
    size: 'number',
    /** ISO timestamp allocation was snapshotted. */
    recordedAt: 'string',
    /** ISO timestamp record was inserted. */
    insertedAt: 'string'
  },
  primaryIndex: { partitionKey: 'space', sortKey: 'recordedAt' }
}

/**
 * Stores changes to total space size.
 *
 * @type {import('@serverless-stack/resources').TableProps}
 */
export const spaceDiffTableProps = {
  fields: {
    /** Customer DID (did:mailto:...). */
    customer: 'string',
    /** Space DID (did:key:...). */
    space: 'string',
    /** Storage provider for the space. */
    provider: 'string',
    /** Subscription in use when the size changed. */
    subscription: 'string',
    /** Invocation CID that changed the space size (bafy...). */
    cause: 'string',
    /** Number of bytes added to or removed from the space. */
    change: 'number',
    /** ISO timestamp the receipt was issued. */
    receiptAt: 'string',
    /** ISO timestamp we recorded the change. */
    insertedAt: 'string'
  },
  primaryIndex: { partitionKey: 'customer', sortKey: 'receiptAt' }
}

/**
 * Stores per space usage across billing periods.
 *
 * @type {import('@serverless-stack/resources').TableProps}
 */
export const usageTableProps = {
  fields: {
    /** Customer DID (did:mailto:...). */
    customer: 'string',
    /**
     * Opaque identifier representing an account in the payment system.
     * 
     * e.g. Stripe customer ID (stripe:cus_9s6XKzkNRiz8i3)
     */
    account: 'string',
    /** Unique identifier of the product a.k.a tier. */
    product: 'string',
    /** Space DID (did:key:...). */
    space: 'string',
    /** Usage in GB/month */
    usage: 'number',
    /**
     * Dual ISO timestamp the invoice covers - inclusive from, exclusive to.
     * 
     * e.g. 2023-10-01T00:00:00.000Z - 2023-11-01T00:00:00.000Z
     */
    period: 'string',
    /** ISO timestamp we created the invoice. */
    insertedAt: 'string'
  },
  primaryIndex: { partitionKey: 'customer', sortKey: 'period' }
}
