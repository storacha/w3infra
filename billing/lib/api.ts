import { DID, Link, LinkJSON, Result, Capabilities, Unit, Failure } from '@ucanto/interface'

// Billing stores /////////////////////////////////////////////////////////////

/** Captures a size change that occurred in a space. */
export interface SpaceDiff {
  /** Storage provider for the space. */
  provider: DID<'web'>
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

export interface SpaceDiffKey { customer: DID<'mailto'> }

export interface SpaceDiffStore extends StorePutter<SpaceDiff> {
  listBetween: (key: SpaceDiffKey, from: Date, to: Date, options?: Pageable) => Promise<Result<ListSuccess<SpaceDiff>, EncodeFailure|DecodeFailure|StoreOperationFailure>>
}

/** Captures size of a space at a given point in time. */
export interface SpaceSnapshot {
  /** Storage provider this snapshot refers to. */
  provider: DID<'web'>
  /** Space this snapshot refers to. */
  space: DID
  /** Total allocated size in bytes. */
  size: bigint
  /** Time the total allocated size was recorded at. */
  recordedAt: Date
  /** Time the snapshot was added to the database. */
  insertedAt: Date
}

export interface SpaceSnapshotKey { provider: DID<'web'>, space: DID, recordedAt: Date }

export type SpaceSnapshotStore =
  & StorePutter<SpaceSnapshot>
  & StoreGetter<SpaceSnapshotKey, SpaceSnapshot>

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

export type CustomerStore = StoreLister<{}, Customer>

/**
 * Captures storage usage by a given customer for a given space in the given
 * time period.
 */
export interface Usage {
  /** Customer DID (did:mailto:...). */
  customer: DID<'mailto'>
  /**
   * Opaque identifier representing an account in the payment system.
   * 
   * e.g. Stripe customer ID (stripe:cus_9s6XKzkNRiz8i3)
   */
  account: string
  /** Unique identifier of the product a.k.a tier. */
  product: string
  /** Storage provider for the space. */
  provider: DID<'web'>
  /** Space DID (did:key:...). */
  space: DID
  /** Usage in byte/ms */
  usage: bigint
  /** Time the usage period spans from (inclusive). */
  from: Date
  /** Time the usage period spans to (exclusive). */
  to: Date
  /** Time the record was added to the database. */
  insertedAt: Date
}

export interface UsageKey { customer: DID<'mailto'>, from: Date }

export type UsageStore = StorePutter<Usage>

// Billing queues /////////////////////////////////////////////////////////////

/**
 * Captures details about a customer that should be billed for a given period
 * of usage.
 */
export interface CustomerBillingInstruction {
  /** Customer DID (did:mailto:...). */
  customer: DID<'mailto'>
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

export type CustomerBillingQueue = QueueAdder<CustomerBillingInstruction>

/**
 * Captures details about a space that should be billed for a given customer in
 * the given period of usage.
 */
export interface SpaceBillingInstruction extends CustomerBillingInstruction {
  /** Space DID (did:key:...). */
  space: DID
  /** Storage provider for the space. */
  provider: DID<'web'>
}

export type SpaceBillingQueue = QueueAdder<SpaceBillingInstruction>

// Upload API stores //////////////////////////////////////////////////////////

export interface Consumer {
  consumer: DID
  provider: DID<'web'>
  subscription: string
  cause: Link
  insertedAt: Date
  updatedAt: Date
}

export interface ConsumerKey { subscription: string, provider: DID<'web'> }
export interface ConsumerListKey { consumer: DID }

export type ConsumerStore =
  & StoreGetter<ConsumerKey, Consumer>
  & StoreLister<ConsumerListKey, Pick<Consumer, 'consumer'|'provider'|'subscription'>>

export interface Subscription {
  customer: DID<'mailto'>
  provider: DID<'web'>
  subscription: string
  cause: Link
  insertedAt: Date
  updatedAt: Date
}

export interface SubscriptionKey { provider: DID<'web'>, subscription: string }
export interface SubscriptionListKey { customer: DID<'mailto'> }

export type SubscriptionStore =
  & StoreGetter<SubscriptionKey, Subscription>
  & StoreLister<SubscriptionListKey, Pick<Subscription, 'customer'|'provider'|'subscription'|'cause'>>

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

/** StorePutter allows a single item to be put in the store by it's key. */
export interface StorePutter<T> {
  /** Puts a single item into the store by it's key */
  put: (rec: T) => Promise<Result<Unit, InvalidInput|EncodeFailure|StoreOperationFailure>>
}

/** StoreGetter allows a single item to be retrieved by it's key. */
export interface StoreGetter<K extends {}, V> {
  /** Gets a single item by it's key. */
  get: (key: K) => Promise<Result<V, EncodeFailure|RecordNotFound<K>|DecodeFailure|StoreOperationFailure>>
}

/** StoreLister allows items in the store to be listed page by page. */
export interface StoreLister<K extends {}, V> {
  /** Lists items in the store. */
  list: (key: K, options?: Pageable) => Promise<Result<ListSuccess<V>, EncodeFailure|DecodeFailure|StoreOperationFailure>>
}

/** QueueAdder allows messages to be added to the end of the queue. */
export interface QueueAdder<T> {
  /** Adds a message to the end of the queue. */
  add: (message: T) => Promise<Result<Unit, InvalidInput|EncodeFailure|QueueOperationFailure>>
}
