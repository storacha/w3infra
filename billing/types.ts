import { DID, Link, LinkJSON, Result, Capabilities, Unit, Failure } from '@ucanto/interface'
import { ListResponse } from '@web3-storage/capabilities/types'

// Billing stores /////////////////////////////////////////////////////////////

/** Captures a size change that occurred in a space. */
export interface SpaceDiffRecord {
  /** Storage provider for the space. */
  provider: DID
  /** Space that changed size. */
  space: DID
  /** Customer responsible for paying for the space at the time the size changed. */
  customer: DID<'mailto'>
  /** Subscription in use when the size changed. */
  subscription: string
  /** UCAN invocation that caused the size change. */
  cause: Link
  /** Number of bytes that were added/removed from the space. */
  change: number
  /** Time the receipt was issued by the service. */
  receiptAt: Date
  /** Time the change was recorded. */
  insertedAt: Date
}

export type SpaceDiffInput = Omit<SpaceDiffRecord, 'insertedAt'>

export interface SpaceDiffStore {
  /** Put a record to the table. */
  put: (input: SpaceDiffInput) => Promise<Result<Unit, Failure>>
}

/** Captures size of a space at a given point in time. */
export interface SpaceSnapshotRecord {
  /** Storage provider this snapshot refers to. */
  provider: DID
  /** Space this snapshot refers to. */
  space: DID
  /** Total allocated size in bytes. */
  size: number
  /** Time the total allocated size was recorded at. */
  recordedAt: Date
  /** Time the snapshot was added to the database. */
  insertedAt: Date
}

export type SpaceSizeSnapshotInput = Omit<SpaceSnapshotRecord, 'insertedAt'>

export interface SpaceSnapshotStore {
  /** Put a record to the table. */
  put: (input: SpaceSizeSnapshotInput) => Promise<Result<Unit, Failure>>
  /** Get the first snapshot recorded after the provided time. */
  getAfter: (provider: DID, space: DID, after: Date) => Promise<Result<SpaceSnapshotRecord, SpaceSnapshotNotFound | Failure>>
}

export interface SpaceSnapshotNotFound extends Failure {
  name: 'SpaceSnapshotNotFound'
  provider: DID
  space: DID
  after: Date
}

export interface CustomerRecord {
  /** CID of the UCAN invocation that set it to the current value. */
  cause: Link,
  /** DID of the user account e.g. `did:mailto:agent`. */
  customer: DID<'mailto'>,
  /**
   * Opaque identifier representing an account in the payment system
   * e.g. Stripe customer ID (stripe:cus_9s6XKzkNRiz8i3)
   */
  account: string,
  /** Unique identifier of the product a.k.a tier. */
  product: string,
  /** ISO timestamp record was inserted. */
  insertedAt: Date,
  /** ISO timestamp record was updated. */
  updatedAt: Date
}

export interface CustomerListOptions extends Pageable {}

export interface CustomerStore {
  /** Paginated listing of customer records. */
  list: (options?: CustomerListOptions) => Promise<Result<ListResponse<CustomerRecord>, Failure>>
}

// Upload API stores //////////////////////////////////////////////////////////

export interface ConsumerRecord {
  consumer: DID
  provider: DID
  subscription: string
  cause: Link
  insertedAt: Date
  updatedAt: Date
}

export interface ConsumerStore {
  /** Get a batch of records for the passed consumer (space) DID. */
  getBatch: (consumer: DID) => Promise<Result<ConsumerRecord[], Failure>>
}

export interface SubscriptionRecord {
  customer: DID<'mailto'>
  provider: DID
  subscription: string
  cause: Link
  insertedAt: Date
  updatedAt: Date
}

export interface SubscriptionStore {
  /** Get a subscription record by ID. */
  get: (provider: DID, subscription: string) => Promise<Result<SubscriptionRecord, SubscriptionNotFound | Failure>>
}

export interface SubscriptionNotFound extends Failure {
  name: 'SubscriptionNotFound'
  provider: DID
  subscription: string
}

// UCAN invocation ////////////////////////////////////////////////////////////

// TODO: replace `UcanInvocation` type in `ucan-invocation/types.ts` with this?
export interface UcanMessage<C extends Capabilities = Capabilities> {
  carCid: Link
  invocationCid: Link
  value: UcanMessageValue<C>
  ts: Date
}

export interface UcanMessageValue<C extends Capabilities = Capabilities> {
  att: C,
  aud: DID,
  iss?: DID,
  prf?: Array<LinkJSON<Link>>
}

export interface UcanReceiptMessage<
  C extends Capabilities = Capabilities,
  R extends Result = Result
> extends UcanMessage<C> {
  type: 'receipt'
  out: R
}

export interface UcanWorkflowMessage<C extends Capabilities = Capabilities> extends UcanMessage<C> {
  type: 'workflow'
}

export type UcanStreamMessage<C extends Capabilities = Capabilities> = UcanWorkflowMessage<C> | UcanReceiptMessage<C>

// Utility ////////////////////////////////////////////////////////////////////

export type { ListResponse }

export interface Pageable {
  /**
   * Opaque string specifying where to start retrival of the next page of
   * results.
   */
  cursor?: string
  /**
   * Maximum number of items to return.
   */
  size?: number
  /**
   * If true, return page of results preceding cursor. Defaults to false.
   */
  pre?: boolean
}
