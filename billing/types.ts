import { DID, Link, LinkJSON, Result, Capabilities, Unit, Failure } from '@ucanto/interface'

// Billing stores /////////////////////////////////////////////////////////////

/** Captures a size change that occurred in a space. */
export interface SpaceDiff {
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
  /** Time the change was added to the database. */
  insertedAt: Date
}

export type SpaceDiffStore = WritableStore<SpaceDiff>

/** Captures size of a space at a given point in time. */
export interface SpaceSnapshot {
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

export interface SpaceSnapshotKey { provider: DID, space: DID }

export interface SpaceSnapshotStore extends WritableStore<SpaceSnapshot> {
  /** Get the first snapshot recorded after the provided time. */
  getAfter: (key: SpaceSnapshotKey, after: Date) => Promise<Result<SpaceSnapshot, EncodeFailure|DecodeFailure|RecordNotFound<SpaceSnapshotKey>>>
}

/**
 * Captures information about a customer of the service that may need to be
 * billed for storage usage.
 */
export interface Customer {
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
  /** Time the record was added to the database. */
  insertedAt: Date,
  /** Time the record was updated in the database. */
  updatedAt: Date
}

export interface CustomerListOptions extends Pageable {}

export interface CustomerStore {
  /** Paginated listing of customer records. */
  list: (options?: CustomerListOptions) => Promise<Result<ListSuccess<Customer>, Failure>>
}

/**
 * Captures storage usage by a given customer for a given space in the given
 * time period.
 */
export interface Usage {
  /** Customer DID (did:mailto:...). */
  customer: DID
  /**
   * Opaque identifier representing an account in the payment system.
   * 
   * e.g. Stripe customer ID (stripe:cus_9s6XKzkNRiz8i3)
   */
  account: string
  /** Unique identifier of the product a.k.a tier. */
  product: string
  /** Space DID (did:key:...). */
  space: DID
  /** Usage in GB/month */
  usage: number
  /** Time the usage period spans from (inclusive). */
  from: Date
  /** Time the usage period spans to (exclusive). */
  to: Date
  /** Time the record was added to the database. */
  insertedAt: Date
}

export type UsageStore = WritableStore<Usage>

// Billing queues /////////////////////////////////////////////////////////////

/**
 * Captures details about a customer that should be billed for a given period
 * of usage.
 */
export interface BillingInstruction {
  /** Customer DID (did:mailto:...). */
  customer: DID
  /**
   * Opaque identifier representing an account in the payment system.
   * 
   * e.g. Stripe customer ID (stripe:cus_9s6XKzkNRiz8i3)
   */
  account: string
  /** Unique identifier of the product a.k.a tier. */
  product: string
  /** Time the billing period spans from (inlusive). */
  from: Date
  /** Time the billing period spans to (exclusive). */
  to: Date
}

export type BillingQueue = Queue<BillingInstruction>

// Upload API stores //////////////////////////////////////////////////////////

export interface Consumer {
  consumer: DID
  provider: DID
  subscription: string
  cause: Link
  insertedAt: Date
  updatedAt: Date
}

export interface ConsumerKey { consumer: DID }

export type ConsumerStore = PaginatedStore<ConsumerKey, Consumer>

export interface Subscription {
  customer: DID<'mailto'>
  provider: DID
  subscription: string
  cause: Link
  insertedAt: Date
  updatedAt: Date
}

export interface SubscriptionKey { provider: DID, subscription: string }

export type SubscriptionStore = ReadableStore<SubscriptionKey, Subscription>

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

export interface ListSuccess<R> {
  /**
   * Opaque string specifying where to start retrival of the next page of
   * results.
   */
  cursor?: string
  results: R[]
}

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
}

export type Encoder<I, O> = (input: I) => Result<O, EncodeFailure>

export type Decoder<I, O> = (input: I) => Result<O, DecodeFailure>

export type Validator<T> = (input: T) => Result<Unit, InvalidInput>

export interface InvalidInput extends Failure {
  name: 'InvalidInput'
  field?: string
}

export interface EncodeFailure extends Failure {
  name: 'EncodeFailure'
}

export interface DecodeFailure extends Failure {
  name: 'DecodeFailure'
}

export interface QueueOperationFailure extends Failure {
  name: 'QueueOperationFailure'
}

export interface StoreOperationFailure extends Failure {
  name: 'StoreOperationFailure'
}

export interface RecordNotFound<K> extends Failure {
  name: 'RecordNotFound'
  key: K
}

export type InferStoreRecord<T> = {
  [Property in keyof T]: T[Property] extends Number ? T[Property] : string
}

export type StoreRecord = Record<string, string|number>

export interface WritableStore<T> {
  put: (rec: T) => Promise<Result<Unit, InvalidInput|EncodeFailure|StoreOperationFailure>>
}

export interface ReadableStore<K extends {}, V> {
  get: (key: K) => Promise<Result<V, EncodeFailure|RecordNotFound<K>|DecodeFailure|StoreOperationFailure>>
}

export interface PaginatedStore<K extends {}, V> {
  list: (key: K, options?: Pageable) => Promise<Result<ListSuccess<V>, EncodeFailure|DecodeFailure|StoreOperationFailure>>
}

export interface Queue<T> {
  add: (message: T) => Promise<Result<Unit, InvalidInput|EncodeFailure|QueueOperationFailure>>
}
