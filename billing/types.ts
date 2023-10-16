import { DID, Link, LinkJSON, Result, Capabilities, Unit, Failure } from '@ucanto/interface'

// Billing stores /////////////////////////////////////////////////////////////

export interface SpaceSizeDiffRecord {
  /** Space that changed size. */
  space: DID
  /** Customer responsible for paying for the space at the time the size changed. */
  customer: DID<'mailto'>
  /** Subscription in use when the size changed. */
  subscription: string
  /** Storage provider for the space. */
  provider: DID
  /** UCAN invocation that caused the size change. */
  cause: Link
  /** Number of bytes that were added/removed from the space. */
  change: number
  /** Time the change was recorded. */
  insertedAt: Date
}

export interface SpaceSizeDiffStore {
  /** Put a batch of records to the table. */
  putBatch: (batch: Array<Omit<SpaceSizeDiffRecord, 'insertedAt'>>) => Promise<Result<Unit, Failure>>
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

export interface SubscriptionTable {
  get: (subscription: string) => Promise<Result<SubscriptionRecord, SubscriptionNotFound | Failure>>
}

export interface SubscriptionNotFound extends Failure {
  name: 'SubscriptionNotFound'
}

// UCAN invocation ////////////////////////////////////////////////////////////

// TODO: replace `UcanInvocation` type in `ucan-invocation/types.ts` with this?
export interface UcanMessage<C extends Capabilities = Capabilities> {
  carCid: Link
  invocationCid: Link
  value: UcanMessageValue<C>
  ts: number
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
